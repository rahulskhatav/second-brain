import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { startAnalytics } from './lib/analytics.js';
import { AuthProvider } from './lib/auth.jsx';

startAnalytics(); // no-op unless VITE_POSTHOG_KEY is set
import './styles/nocturne.css';
import './styles/app.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
