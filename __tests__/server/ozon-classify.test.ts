import { describe, it, expect } from "vitest";
import { classifyOperationType } from "../../server/ozon/classifyOperation";

describe("classifyOperationType", () => {
  it.each([
    ["OperationAgentDeliveredToCustomer", "sale"],
    ["ClientReturnAgentOperation", "refund"],
    ["OperationReturnGoodsFBSofRMS", "refund"],
    ["MarketplaceServiceItemDelivToCustomer", "last_mile"],
    ["MarketplaceServiceItemReturnFlowTrans", "last_mile"],
    ["MarketplaceServiceItemDirectFlowTrans", "logistics"],
    ["MarketplaceServiceItemFulfillment", "logistics"],
    ["MarketplaceServiceItemDropoffPVZ", "logistics"],
    ["OperationMarketplaceServiceStorage", "storage"],
    ["MarketplaceRedistributionOfAcquiringOperation", "commission"],
  ])("%s → %s", (op, expected) => {
    expect(classifyOperationType(op)).toBe(expected);
  });

  it("falls back via keyword for unknown patterns", () => {
    expect(classifyOperationType("NewlyAddedReturnSomething")).toBe("refund");
    expect(classifyOperationType("XStorageY")).toBe("storage");
    expect(classifyOperationType("FooFulfillmentBar")).toBe("logistics");
  });

  it("returns 'other' for empty / unrelated", () => {
    expect(classifyOperationType("")).toBe("other");
    expect(classifyOperationType("MarketplaceMarketingActionCostOperation")).toBe(
      "other",
    );
    expect(classifyOperationType("OperationCorrection")).toBe("other");
  });
});
