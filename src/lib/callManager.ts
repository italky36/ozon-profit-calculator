/** WebRTC peer-connection manager — Stage 5.
 *
 * Per-call state machine that owns RTCPeerConnections (mesh: one per remote
 * peer), local MediaStream (mic / camera), and the signaling glue that maps
 * server WS events → SDP / ICE handling.
 *
 * Single instance per active call lives in ChatPage. On hangup / end the
 * caller invokes dispose() which tears down every PC + stops media tracks.
 *
 * Signaling contract:
 *   - Caller emits call.invite on WS → server replies call.created (carries
 *     callId + invitedUserIds).
 *   - Server fans out call.incoming to invitees → they call accept() → server
 *     publishes call.accepted (UI status) AND call.peer-joined (authoritative
 *     mesh handshake, carries connectedUserIds snapshot).
 *   - On call.peer-joined, every peer ALREADY in connectedUserIds (excluding
 *     the newcomer) sends an SDP offer to the newcomer. The newcomer waits
 *     for incoming offers. Server serialises accepts so each peer-joined
 *     has a unique newcomer — no glare in the mesh.
 *   - Server proxies call.offer / call.answer / call.ice between peers (with
 *     allowedUserIds filter so other workspace subscribers never see SDP).
 */

import type { ChatServerEvent } from "../api";

export type CallType = "audio" | "video";

export interface RemotePeer {
  userId: number;
  stream: MediaStream | null;
}

export interface CallState {
  callId: number;
  channelId: number;
  callType: CallType;
  role: "caller" | "callee";
  /** Initiator userId — used by UI to label «from X». */
  initiatorUserId: number;
  /** All userIds invited (incl. self). Shrinks when a peer declines in a
   *  group call (call.peer-declined). */
  invitedUserIds: number[];
  /** Userids of peers currently in the call (joined + still connected).
   *  Authoritative snapshot from server via `call.peer-joined`; UI uses it
   *  to label tile status (connected vs ringing). */
  connectedUserIds: Set<number>;
  /** Map of remote userId → MediaStream once their tracks arrive. */
  remotePeers: Map<number, MediaStream>;
  localStream: MediaStream | null;
  /** 'ringing' = invite sent / received, no SDP yet; 'connecting' = SDP
   *  exchanged, ICE candidates flowing; 'live' = at least one peer connected;
   *  'ended' = teardown done. */
  status: "ringing" | "connecting" | "live" | "ended";
  micMuted: boolean;
  cameraOff: boolean;
}

interface SignalingSend {
  (msg: Record<string, unknown>): void;
}

export class CallManager {
  private pcs = new Map<number, RTCPeerConnection>();
  private iceServers: RTCIceServer[];
  private send: SignalingSend;
  private onUpdate: (state: CallState) => void;
  private selfUserId: number;
  private state: CallState;
  private pendingIce = new Map<number, RTCIceCandidateInit[]>();

  constructor(opts: {
    selfUserId: number;
    iceServers: RTCIceServer[];
    send: SignalingSend;
    onUpdate: (state: CallState) => void;
    initial: CallState;
  }) {
    this.selfUserId = opts.selfUserId;
    this.iceServers = opts.iceServers;
    this.send = opts.send;
    this.onUpdate = opts.onUpdate;
    this.state = opts.initial;
  }

  getState(): CallState {
    return this.state;
  }

  /** Acquire mic / camera. Called immediately for the caller; for callees
   * after accept(). Throws on permission denied — caller surfaces a UI
   * error and disposes the manager. */
  async acquireMedia(): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: true,
      video: this.state.callType === "video",
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.state = { ...this.state, localStream: stream };
    this.emit();
    return stream;
  }

  /** Build a peer connection toward `peerUserId`, attach local tracks, wire
   * up SDP / ICE handlers. Idempotent — returns the existing PC if one was
   * already created. */
  private pcFor(peerUserId: number): RTCPeerConnection {
    let pc = this.pcs.get(peerUserId);
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pcs.set(peerUserId, pc);
    if (this.state.localStream) {
      for (const track of this.state.localStream.getTracks()) {
        pc.addTrack(track, this.state.localStream);
      }
    }
    pc.addEventListener("icecandidate", (evt) => {
      if (!evt.candidate) return;
      this.send({
        type: "call.ice",
        callId: this.state.callId,
        to: peerUserId,
        candidate: evt.candidate.toJSON(),
      });
    });
    pc.addEventListener("track", (evt) => {
      const [stream] = evt.streams;
      if (!stream) return;
      this.state.remotePeers.set(peerUserId, stream);
      if (this.state.status !== "live") {
        this.state = { ...this.state, status: "live" };
      } else {
        this.state = { ...this.state };
      }
      this.emit();
    });
    pc.addEventListener("connectionstatechange", () => {
      if (
        pc!.connectionState === "failed" ||
        pc!.connectionState === "disconnected"
      ) {
        // Try ICE restart once; if that doesn't recover within a few seconds
        // the user can press hangup.
        try {
          pc!.restartIce();
        } catch {
          /* not supported in some envs */
        }
      }
    });
    return pc;
  }

  /** Caller path. After getting call.accepted from a peer, create an offer
   * for them and send it through the signaling channel. */
  async startOfferTo(peerUserId: number): Promise<void> {
    const pc = this.pcFor(peerUserId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({
      type: "call.offer",
      callId: this.state.callId,
      to: peerUserId,
      sdp: offer,
    });
    if (this.state.status === "ringing") {
      this.state = { ...this.state, status: "connecting" };
      this.emit();
    }
  }

  /** Callee path. On receiving an offer, set it, create + send an answer. */
  async handleOffer(
    fromUserId: number,
    sdp: RTCSessionDescriptionInit,
  ): Promise<void> {
    const pc = this.pcFor(fromUserId);
    await pc.setRemoteDescription(sdp);
    // Drain any ICE candidates we buffered before the description landed.
    const buffered = this.pendingIce.get(fromUserId);
    if (buffered) {
      for (const c of buffered) {
        try {
          await pc.addIceCandidate(c);
        } catch {
          /* malformed candidate — skip */
        }
      }
      this.pendingIce.delete(fromUserId);
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.send({
      type: "call.answer",
      callId: this.state.callId,
      to: fromUserId,
      sdp: answer,
    });
    if (this.state.status === "ringing") {
      this.state = { ...this.state, status: "connecting" };
      this.emit();
    }
  }

  async handleAnswer(
    fromUserId: number,
    sdp: RTCSessionDescriptionInit,
  ): Promise<void> {
    const pc = this.pcs.get(fromUserId);
    if (!pc) return;
    await pc.setRemoteDescription(sdp);
    const buffered = this.pendingIce.get(fromUserId);
    if (buffered) {
      for (const c of buffered) {
        try {
          await pc.addIceCandidate(c);
        } catch {
          /* skip */
        }
      }
      this.pendingIce.delete(fromUserId);
    }
  }

  async handleIce(
    fromUserId: number,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    const pc = this.pcs.get(fromUserId);
    if (!pc || !pc.remoteDescription) {
      // Description not set yet — buffer for later. Otherwise addIceCandidate
      // throws InvalidStateError.
      let buf = this.pendingIce.get(fromUserId);
      if (!buf) {
        buf = [];
        this.pendingIce.set(fromUserId, buf);
      }
      buf.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      /* skip malformed */
    }
  }

  /** Local-side mute / unmute. Toggle the enabled flag on each local audio
   * track; remote peers don't need a signal — the track just goes silent. */
  toggleMic(): void {
    const tracks = this.state.localStream?.getAudioTracks() ?? [];
    const next = !this.state.micMuted;
    for (const t of tracks) t.enabled = !next;
    this.state = { ...this.state, micMuted: next };
    this.emit();
  }

  toggleCamera(): void {
    const tracks = this.state.localStream?.getVideoTracks() ?? [];
    const next = !this.state.cameraOff;
    for (const t of tracks) t.enabled = !next;
    this.state = { ...this.state, cameraOff: next };
    this.emit();
  }

  /** External signal — server pushed call.peer-left or call.ended. Clean up
   * that peer's PC (or all of them on call.ended). */
  removePeer(peerUserId: number): void {
    const pc = this.pcs.get(peerUserId);
    if (pc) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      this.pcs.delete(peerUserId);
    }
    this.state.remotePeers.delete(peerUserId);
    this.emit();
  }

  dispose(): void {
    for (const pc of this.pcs.values()) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    }
    this.pcs.clear();
    for (const track of this.state.localStream?.getTracks() ?? []) {
      track.stop();
    }
    this.state = { ...this.state, status: "ended", localStream: null };
    this.emit();
  }

  private emit(): void {
    this.onUpdate(this.state);
  }

  /** Dispatch a server WS event into the manager. Returns true if the event
   * was handled (caller can skip its own routing). */
  async dispatch(event: ChatServerEvent): Promise<boolean> {
    if (!("callId" in event) || event.callId !== this.state.callId) {
      return false;
    }
    switch (event.type) {
      case "call.accepted": {
        // Pure UI signal — the actual SDP-handshake is driven by
        // `call.peer-joined` which carries the connectedUserIds snapshot.
        // Kept for clients that still observe this transition.
        if (this.state.status === "ringing") {
          this.state = { ...this.state, status: "connecting" };
          this.emit();
        }
        return true;
      }
      case "call.peer-joined": {
        // Authoritative mesh-handshake signal: the newcomer (`userId`) just
        // connected. Every peer that was ALREADY in `connectedUserIds`
        // before this event (i.e. anyone in the new snapshot except the
        // newcomer themselves) offers SDP to the newcomer. The newcomer
        // itself sends no offers and waits for incoming ones.
        //
        // No glare possible: server serialises acceptCall, so each
        // peer-joined event has a unique newcomer. Already-connected peers
        // offer one at a time as each new participant arrives — every pair
        // has exactly one offerer (the older participant).
        const newPeer = event.payload.userId;
        const snapshot = event.payload.connectedUserIds;
        this.state.connectedUserIds = new Set(snapshot);
        if (newPeer === this.selfUserId) {
          this.emit();
          return true;
        }
        const wasConnectedBefore = snapshot
          .filter((uid) => uid !== newPeer)
          .includes(this.selfUserId);
        if (wasConnectedBefore) {
          await this.startOfferTo(newPeer);
        } else {
          this.emit();
        }
        return true;
      }
      case "call.offer": {
        if (event.payload.to !== this.selfUserId) return true;
        if (event.payload.sdp) {
          await this.handleOffer(event.payload.from, event.payload.sdp);
        }
        return true;
      }
      case "call.answer": {
        if (event.payload.to !== this.selfUserId) return true;
        if (event.payload.sdp) {
          await this.handleAnswer(event.payload.from, event.payload.sdp);
        }
        return true;
      }
      case "call.ice": {
        if (event.payload.to !== this.selfUserId) return true;
        if (event.payload.candidate) {
          await this.handleIce(event.payload.from, event.payload.candidate);
        }
        return true;
      }
      case "call.peer-left": {
        this.removePeer(event.payload.userId);
        this.state.connectedUserIds.delete(event.payload.userId);
        this.emit();
        return true;
      }
      case "call.peer-declined": {
        // Group-call: one invitee declined but the call continues. Drop
        // their PC + remove them from local rosters.
        const uid = event.payload.userId;
        this.removePeer(uid);
        this.state.connectedUserIds.delete(uid);
        this.state.invitedUserIds = this.state.invitedUserIds.filter(
          (x) => x !== uid,
        );
        this.emit();
        return true;
      }
      case "call.ended":
      case "call.declined": {
        this.dispose();
        return true;
      }
      default:
        return false;
    }
  }
}
