import { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowDownToLine, Check, RefreshCw, Share, Smartphone, Wifi, WifiOff } from 'lucide-react';
import { applyAppUpdate, getPwaState, requestAppInstall, subscribePwa } from '../pwa';
import './install-panel.css';

export default function InstallPanel() {
  const pwa = useSyncExternalStore(subscribePwa, getPwaState);
  const [online, setOnline] = useState(navigator.onLine);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const [notice, setNotice] = useState('');
  const [installing, setInstalling] = useState(false);
  const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  useEffect(() => {
    const network = () => setOnline(navigator.onLine);
    const installedApp = () => { setInstalled(true); setNotice('CAP a été ajouté à votre appareil.'); };
    window.addEventListener('online', network); window.addEventListener('offline', network); window.addEventListener('appinstalled', installedApp);
    return () => { window.removeEventListener('online', network); window.removeEventListener('offline', network); window.removeEventListener('appinstalled', installedApp); };
  }, []);
  async function install() {
    setInstalling(true);
    const result = await requestAppInstall();
    setInstalling(false);
    setNotice(result === 'accepted' ? 'Installation acceptée. Retrouvez CAP sur votre appareil.' : result === 'dismissed' ? 'Vous pourrez installer CAP plus tard.' : 'Utilisez le menu de votre navigateur pour ajouter CAP à l’écran d’accueil.');
  }
  return <section className="card settings-card install-panel" aria-labelledby="install-heading">
    <div className="install-heading"><span className="metric-icon mint"><Smartphone size={21} /></span><span className={`install-network ${online ? '' : 'is-offline'}`}>{online ? <Wifi size={13} /> : <WifiOff size={13} />}{online ? 'Réseau disponible' : 'Hors connexion'}</span></div>
    <h2 id="install-heading">CAP, sur votre téléphone</h2>
    {installed ? <p className="install-success"><Check size={16} /> Vous utilisez CAP comme une application.</p> : pwa.unavailable === 'standalone-file' ? <p>Ce fichier permet d’ouvrir votre tableau de bord. Pour installer CAP sur l’écran d’accueil, ouvrez sa version en ligne dans le navigateur de votre téléphone.</p> : <>
      <p>Gardez votre espace à portée de main, avec une icône sur votre écran d’accueil.</p>
      {pwa.installAvailable ? <button className="button button-primary" onClick={install} disabled={installing}><ArrowDownToLine size={16} />{installing ? 'Installation…' : 'Installer CAP'}</button> : isApple ? <div className="install-steps"><span><Share size={16} /><strong>1.</strong> Dans Safari, ouvrez le menu Partager.</span><span><Smartphone size={16} /><strong>2.</strong> Choisissez « Sur l’écran d’accueil », puis « Ajouter ».</span></div> : <div className="install-steps"><span><Smartphone size={16} />Dans le menu de Chrome ou Edge, choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil » si l’option est proposée.</span></div>}
      {pwa.unavailable && pwa.unavailable !== 'unsupported' && <p className="install-detail">L’installation nécessite la version en ligne sécurisée de CAP. Les instructions restent disponibles pour votre téléphone.</p>}
      {pwa.unavailable === 'unsupported' && <p className="install-detail">Votre navigateur ne propose pas l’installation. CAP reste utilisable dans un onglet.</p>}
    </>}
    {!online && <p className="install-detail">L’interface déjà chargée peut rester accessible. La connexion au compte, la synchronisation et les réponses IA nécessitent Internet.</p>}
    {pwa.registrationFailed && <p className="install-detail">La préparation de l’accès hors connexion n’a pas abouti. Vous pouvez continuer dans le navigateur et réessayer après rechargement.</p>}
    {pwa.updateAvailable && <div className="install-update"><p>Une nouvelle version de CAP est prête. L’application sera rechargée ; terminez votre message en cours avant de continuer.</p><button className="button button-secondary" onClick={applyAppUpdate}><RefreshCw size={15} />Mettre à jour CAP</button></div>}
    {notice && <p className="install-detail" role="status">{notice}</p>}
  </section>;
}
