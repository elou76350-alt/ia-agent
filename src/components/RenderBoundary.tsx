import { Component, type ErrorInfo, type ReactNode } from 'react';

export default class RenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Never log workspace contents. */ }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="render-fallback" role="alert">
      <span className="eyebrow">CAP · RETROUVER VOTRE ESPACE</span>
      <h1>L’affichage a rencontré un problème.</h1>
      <p>Rechargez la page pour réessayer. Cette action n’efface pas les données enregistrées dans ce navigateur.</p>
      <button className="button button-primary" onClick={() => window.location.reload()}>Recharger l’application</button>
      <p>Si le message vient de la fenêtre de visualisation de votre outil, téléchargez le fichier autonome CAP.html et ouvrez-le directement dans Chrome, Edge, Firefox ou Safari.</p>
    </main>;
  }
}
