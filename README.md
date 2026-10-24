# CAP — Votre vie. Votre direction.

Application personnelle francophone installable sur iPhone et Android : connexion privée, conversation, budget, carrière, objectifs et journal de bien-être. Le parcours professionnel initial est adapté à un **Patient Experience Specialist**. Les montants et objectifs d'exemple sont signalés comme fictifs ; le pays reste à renseigner.

Pour reprendre le projet dans Codex : lire [AGENTS.md](AGENTS.md) et [la passation complète](docs/CODEX-HANDOFF.md).

**Priorité actuelle : 0 € avec Cloudflare Workers Free.** Une variante complète avec D1 et le quota gratuit Workers AI est fournie dans [le guide gratuit](docs/GRATUIT-CLOUDFLARE.md). Elle utilise un modèle différent de GPT-5.4, ne nécessite pas de clé OpenAI et bloque les demandes au-delà des limites au lieu de basculer sur un fournisseur payant. L’accès au compte Cloudflare et la publication réelle restent à effectuer.

## Installer CAP sur iPhone

Sans domaine ni serveur existant, utiliser d’abord [le chemin gratuit Cloudflare](docs/GRATUIT-CLOUDFLARE.md). Le chemin [Render](docs/HEBERGEMENT-SIMPLE.md) reste une alternative payante, pas le choix actuel de l’utilisateur.

La version complète nécessite un serveur HTTPS : voir [le déploiement](docs/DEPLOIEMENT.md). Une fois ce serveur configuré, ouvrir son adresse dans **Safari**, créer le compte propriétaire avec le code privé du serveur, puis choisir **Partager → Sur l’écran d’accueil → Ajouter**. CAP apparaît avec son icône et s’ouvre sans les barres habituelles du navigateur. Il ne s’agit pas d’une publication dans l’App Store.

La conversation, la connexion au compte et la synchronisation nécessitent Internet. Le service worker ne met en cache que les fichiers publics de l’interface, jamais les API, sessions ou données personnelles. Les modifications non synchronisées du mode privé restent en mémoire : les exporter avant de quitter si la sauvegarde échoue.

## Compte privé et sauvegarde

Le mode privé utilise un compte propriétaire unique. `CAP_AUTH_ENABLED=1` active les formulaires de création, connexion, déconnexion et changement de mot de passe. Pour créer le premier compte, renseigner un `CAP_SETUP_CODE` d’au moins 16 caractères dans les secrets **locaux du serveur hôte**, puis saisir ce code dans le formulaire initial. Ce code n’est ni un mot de passe ni une clé IA, ne doit pas être un placeholder de proxy réseau, et peut être retiré de la configuration après création du compte. Ne jamais transmettre de valeur dans le chat.

Les mots de passe sont hachés avec scrypt et sel aléatoire. Les sessions sont conservées côté serveur ; le navigateur utilise un cookie HttpOnly, SameSite=Strict, Secure en production. Un changement de mot de passe déconnecte les anciennes sessions.

`CAP_DATA_DIR` contient la base SQLite et sa clé de chiffrement. Le contenu de l’espace est chiffré en AES-256-GCM. Il faut **sauvegarder tout le dossier**, notamment `.workspace-key` : sa perte empêche de récupérer les données. Cette protection ne protège pas contre un hébergeur compromis qui disposerait aussi de la clé.

Les écritures utilisent des révisions pour éviter d’écraser les changements d’un autre appareil. En cas de conflit, exporter les changements locaux, puis recharger la sauvegarde serveur. Les données locales du mode découverte ne sont jamais importées automatiquement dans un compte.

## Démarrage local

Prérequis : Node.js 24 et npm (`node:sqlite` est utilisé par l’API).

```sh
cd /workspace/ia-agent
npm ci --cache /workspace/.cache/npm
npm run dev
```

Le serveur Vite écoute sur le port 5173 et transmet les requêtes `/api` au serveur local sur le port 3001. Le serveur API écoute par défaut sur `127.0.0.1`. Ce démarrage est un mode de développement local sans compte ; ne pas l’exposer publiquement. La production exige `CAP_AUTH_ENABLED=1` et refuse de démarrer sans authentification.

Pour exécuter la version compilée avec un seul serveur :

```sh
npm run build
npm start
```

Les fichiers statiques compilés et l'API sont alors servis sur le port 3001. `PORT` et `HOST` sont configurables côté serveur. Les processus doivent être relancés dans une nouvelle session cloud.

## Si la fenêtre de visualisation affiche une erreur

L'application nécessite un navigateur exécutant JavaScript et le serveur Vite ou la version compilée ; ouvrir directement le fichier source `index.html` ne fonctionne pas. Les tests navigateur vérifient les vrais fichiers compilés et toutes les vues sur ordinateur et mobile. Une erreur générique du panneau de visualisation de l'outil ne prouve pas une erreur de l'application.

Pour créer un fichier autonome qui s'ouvre directement dans un navigateur :

```sh
npm run standalone
```

Le résultat est `/workspace/outputs/CAP.html` : télécharger le fichier puis l'ouvrir dans Chrome, Edge, Firefox ou Safari. Il inclut les ressources nécessaires, fonctionne sans serveur pour le tableau de bord, le budget, les objectifs et le journal, et n'embarque ni clé ni données personnelles. La conversation y est explicitement désactivée : elle demande l'application avec son serveur. Le stockage dépend des permissions du navigateur ; l'application signale si l'enregistrement est indisponible.

Pour le développement, démarrer `npm run dev`. Si l'API est déjà active sur 3001, démarrer seulement `npm exec vite -- --host 0.0.0.0`. Un hostname de prévisualisation externe doit être autorisé explicitement via `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`, en utilisant le nom réel fourni par votre outil ; ne pas désactiver le contrôle d'hôte avec `allowedHosts: true`.

Un écran de récupération permet de recharger l'application si React rencontre une erreur d'affichage, sans effacer les données.

## Activer la conversation IA

Sans clé, le **mode découverte** propose des exercices déterministes locaux : il ne s'agit pas d'une conversation générée par un modèle. Il fonctionne sans fournisseur externe et ne se fait pas passer pour une IA connectée.

Pour des réponses libres, configurez `AGENT_API_KEY` uniquement dans les variables sécurisées de l'environnement serveur ou dans un fichier local `.env` ignoré par Git (voir `.env.example`). Ne saisissez jamais une clé dans le chat et ne créez jamais de variable `VITE_` contenant un secret. `AGENT_MODEL` vaut par défaut `gpt-5.4`. Le raisonnement approfondi est activé par défaut avec `AGENT_REASONING_EFFORT=high` pour les modèles compatibles. Un modèle différent reste configurable ; les modèles non compatibles ne reçoivent pas ce paramètre. Ce choix améliore la capacité prévue du modèle, sans garantir un résultat ni un QI. Les réponses complexes peuvent demander jusqu’à 90 secondes. Redémarrez le serveur après modification. L'accès HTTPS à `api.openai.com` et un compte API disposant du modèle/crédit sont nécessaires. Les proxies standards `HTTP_PROXY`/`HTTPS_PROXY` sont pris en charge sans désactiver TLS.

L'API utilise OpenAI Responses avec `store: false`. Cela ne garantit pas une absence de traitement ou de conservation technique chez le fournisseur : ses conditions s'appliquent. Une configuration de clé ne prouve pas que le compte fonctionne ; les erreurs d'accès, de crédit, de délai et de réseau sont affichées sans fausse réponse de remplacement.

## Données et périmètre

- En mode privé, profil, budget, objectifs, habitudes, journal et conversation sont sauvegardés chiffrés sur le serveur après connexion. Ils ne sont pas recopiés dans le localStorage. En mode local ou fichier autonome, ils restent dans le localStorage du navigateur, sans chiffrement applicatif ni synchronisation. Les préférences permettent l’export JSON et l’effacement de l’espace ; le compte propriétaire est conservé.
- Le mode IA transmet les messages que vous envoyez au fournisseur. Le profil, les totaux du budget et les titres des objectifs ne sont ajoutés que si vous cochez l'option correspondante. Le journal de bien-être n'est jamais joint automatiquement. Le serveur applicatif ne journalise ni les conversations ni les clés.
- N'inscrivez pas de données identifiantes concernant des patients dans les exercices métier. Le journal sert à la réflexion personnelle, pas au stockage d'un dossier médical.
- Les recherches d'emploi ouvrent des sites externes. Aucun accès aux offres en direct, aucune candidature envoyée automatiquement. Les trames de messages sont éditables et à compléter avec vos expériences réelles.
- Aucun compte bancaire connecté, aucun paiement, aucun diagnostic, prescription ou garantie de richesse. La visualisation sert à préparer une action concrète et n'est pas présentée comme une loi scientifique.
- SMS, WhatsApp et iMessage ne sont pas connectés. Leur intégration nécessiterait un fournisseur, une configuration et une validation distincts.
- L’application est un espace personnel à propriétaire unique, avec authentification en production. Le serveur ne propose pas d’inscription publique, de récupération par email, de services SMS ou de comptes multiples. Le déploiement Docker et le proxy HTTPS sont fournis dans le dépôt ; aucun hébergement extérieur n’a été créé automatiquement.

## Validation

```sh
npm test
npm run build
npm run test:e2e
npm run test:private
```

Les tests couvrent également la création du propriétaire, les sessions, la rotation du mot de passe, la persistance chiffrée, les conflits entre appareils et les règles du cache PWA. Les tests API couvrent les calculs, la validation, les erreurs du fournisseur, les origines, la confidentialité des requêtes et les limites de débit. Les tests navigateur utilisent Chromium installé dans `/usr/bin/chromium` dans l'environnement cloud. Les appels réels au fournisseur ne sont pas exécutés par les tests : les réponses sont simulées dans les tests API, et le navigateur vérifie le mode découverte.

Le dépôt est déjà isolé dans chaque tâche cloud : utilisez le checkout existant sans créer de worktree supplémentaire, sauf demande explicite.

## Livrer l’application complète

```sh
npm run release
```

Le dossier de déploiement complet est généré dans `/workspace/outputs/CAP-application.tar.gz`, sans données personnelles, `.env`, base de données, clé de chiffrement ni dépendances téléchargées. Suivre `docs/DEPLOIEMENT.md` pour démarrer sur un serveur avec HTTPS. La publication d’un environnement cloud ne publie pas automatiquement un site accessible à l’iPhone.
