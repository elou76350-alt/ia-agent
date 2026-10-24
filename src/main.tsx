import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import RenderBoundary from './components/RenderBoundary';
import AccountGate from './components/AccountGate';
import { registerServiceWorker } from './pwa';
import './styles.css';

void registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><RenderBoundary><AccountGate>{session => <App key={session.authRequired ? session.user?.username : 'local'} authRequired={session.authRequired} account={session.user} initialWorkspace={session.initialWorkspace} initialRevision={session.initialRevision} onLogout={session.onLogout} />}</AccountGate></RenderBoundary></React.StrictMode>);
