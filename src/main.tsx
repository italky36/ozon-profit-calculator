import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import RootRouter from './RootRouter'
import { AuthProvider } from './contexts/AuthProvider'
import { ToastProvider } from './contexts/ToastProvider'
import CookieNotice from './components/CookieNotice'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <RootRouter />
        <CookieNotice />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>,
)
