# Passation du projet CAP à Codex

## Demande à reprendre

L’utilisateur veut son application personnelle francophone sur iPhone : pouvoir discuter avec un assistant, organiser ses objectifs, apprendre à gérer ses finances et progresser dans son métier de **Patient Experience Specialist**. Il souhaite une expérience aboutie et simple à utiliser. Il a ensuite demandé la publication du projet sur GitHub, puis la transmission du projet à Codex.

Ne pas lui redemander son téléphone, son métier ou s’il possède un hébergement : **iPhone**, **Patient Experience Specialist**, **aucun domaine ni hébergement** sont déjà confirmés. Son pays de recherche professionnelle reste à renseigner.

Le dépôt distant est [elou76350-alt/ia-agent](https://github.com/elou76350-alt/ia-agent), branche `main`. Le premier envoi du projet complet est le commit `9c33fe1ce9149fbd4a362f39b4dbcf800c90a9c0`. Les fichiers de cette passation sont ajoutés après ce commit.

Ce document transmet le contexte de développement utile. Il ne contient ni l’intégralité de la conversation personnelle, ni dossier médical, ni identifiant ou valeur secrète.

## Ce qui existe

- Interface React/TypeScript en français, responsive, fond crème et navigation vert forêt.
- Tableau de bord, revenus/épargne/dépenses, objectifs, habitudes, journal de bien-être.
- Parcours carrière adapté à l’expérience patient : exercices fictifs, PREMs/PROMs, liens de recherche d’emploi et trame de candidature éditable. Aucune offre n’est consultée en direct et aucun message n’est envoyé automatiquement.
- Conversation via API OpenAI Responses. Modèle par défaut `gpt-5.4`, effort `high`, délai fournisseur de 90 secondes et délai client de 110 secondes. L’option de contexte partage explicitement profil, totaux du budget et objectifs ; pas le journal automatiquement.
- Mode découverte local lorsque la clé manque. Les refus et erreurs du fournisseur restent visibles, sans fausse réponse de remplacement.
- Compte propriétaire unique : création initiale protégée par code, connexion/déconnexion, changement de mot de passe, révocation des anciennes sessions. Mots de passe hachés avec scrypt ; sessions opaques avec cookie HttpOnly/SameSite=Strict/Secure en production.
- Sauvegarde SQLite chiffrée en AES-256-GCM, révisions pour prévenir les écrasements, gestion des conflits et export JSON.
- PWA : manifeste, icônes, instructions Safari et service worker limité aux ressources publiques. La connexion au compte et la conversation nécessitent Internet. Les modifications privées non synchronisées restent en mémoire ; avertir avant fermeture et permettre l’export.
- Docker multi-stage non-root, compose avec disque persistant, proxy Caddy HTTPS et configuration Render. Export autonome HTML et archive de livraison disponibles.

## Architecture et fichiers

| Élément | Emplacement |
|---|---|
| Application, navigation et intégration de la synchronisation | `src/App.tsx` |
| Compte et contrôle d’accès de l’interface | `src/components/AccountGate.tsx` |
| Sauvegarde et conflits côté client | `src/useWorkspaceSync.ts` |
| Types et validation du format de sauvegarde | `src/types.ts`, `src/workspace-types.ts`, `src/data.ts` |
| Installation et état de la PWA | `src/pwa.ts`, `src/components/InstallPanel.tsx` |
| Serveur, routes, contrôle d’origine, fournisseur IA | `server/index.mjs` |
| Comptes, sessions, chiffrement et révisions | `server/accounts.mjs` |
| Validation des conversations, consignes et exercices locaux | `server/coach.mjs` |
| Cache public versionné | `public/sw.js`, `scripts/build-pwa.mjs` |
| Déploiement géré | `render.yaml`, `docs/HEBERGEMENT-SIMPLE.md` |
| Déploiement sur serveur propre | `Dockerfile`, `compose.yaml`, `Caddyfile`, `docs/DEPLOIEMENT.md` |
| Livraison sans données privées | `scripts/package-release.mjs` |

## Démarrer et valider

Utiliser Node.js 24 et le checkout existant. Dans le cloud, le chemin utilisé était `/workspace/ia-agent` ; adapter seulement si le checkout est ailleurs.

```sh
cd /workspace/ia-agent
npm ci --cache /workspace/.cache/npm
npm run build
npm test
npm run dev
```

Le développement expose Vite sur 5173 et l’API sur 3001. Sans authentification activée, ce mode est uniquement local. Pour servir le client compilé, utiliser `npm start` après le build. Arrêter uniquement les processus lancés par la tâche quand un redémarrage est nécessaire.

Tests complémentaires :

```sh
npm run test:e2e
npm run test:private
```

Les tests privés utilisent leur propre base temporaire et de faux identifiants de test. Ils ne créent pas le vrai compte de l’utilisateur. Ne pas exposer ce serveur de test ou reprendre ses identifiants en production.

Les vérifications déjà réalisées avant cette passation :

- Build TypeScript/Vite/PWA réussi.
- **43 tests** de logique, API, comptes, chiffrement, intégration, PWA et export réussis.
- **8 parcours navigateur locaux** et **7 parcours privés distincts** réussis. Les parcours privés ont été exécutés dans deux lancements avec une création initiale répétée ; ne pas annoncer un unique lancement de sept tests.
- Service worker activé dans Chromium : neuf ressources publiques en cache, aucune API, session ou donnée privée. Rechargement hors connexion sans contournement du compte.
- Image Docker construite et testée réellement : compte et données conservés après redémarrage, cookies Secure, sauvegarde, détection d’un conflit et déconnexion. Conteneur de test et volume supprimés ensuite.
- Vérification mobile réalisée avec Chromium, viewport et agent utilisateur iPhone/Safari, pas sur un appareil iPhone physique ni un site public.

Ces résultats décrivent la préparation précédente ; ils ne valent pas exécution dans une nouvelle tâche ou après de nouveaux changements. Réexécuter les vérifications nécessaires à la modification, sans répéter inutilement les suites pour une simple documentation.

## Variables et données persistantes

| Nom | Rôle |
|---|---|
| `AGENT_API_KEY` | Clé fournisseur côté serveur ; manquante lors de la dernière vérification. |
| `AGENT_MODEL` | Modèle configurable, défaut `gpt-5.4`. |
| `AGENT_REASONING_EFFORT` | Effort compatible avec le modèle, défaut `high`. |
| `CAP_AUTH_ENABLED` | `1` obligatoire lorsque `NODE_ENV=production`. |
| `CAP_SETUP_CODE` | Code privé local d’au moins 16 caractères pour créer le premier propriétaire ; manque tant que l’hébergeur n’est pas configuré. |
| `CAP_DATA_DIR` | Dossier persistant contenant base et `.workspace-key`. |
| `APP_ORIGIN` | Origine HTTPS exacte si nécessaire derrière le proxy, sans barre finale. |
| `HOST`, `PORT` | Adresse et port d’écoute ; la plateforme gérée peut fournir `PORT`. |

La base et sa clé doivent être sauvegardées ensemble. Le chiffrement ne protège pas contre un hébergeur compromis qui possède aussi cette clé. Ne jamais perdre, régénérer ou supprimer la clé d’une base existante pour contourner une erreur.

Les secrets de proxy réseau ne remplacent pas un secret local à comparer comme `CAP_SETUP_CODE`. Vérifier les métadonnées et la présence des variables avant toute demande supplémentaire, sans afficher leurs valeurs. Ne jamais demander les secrets dans le chat.

## État de mise en ligne et suite utile

**Aucun hébergement, domaine, compte Render, service payant ou déploiement public n’a été créé. La clé IA n’a pas été fournie et aucun appel réel au fournisseur n’a été validé.** Le dernier état de l’instance locale était `mode=discovery`, `configured=false`, `providerVerified=false`.

Le chemin proposé est Render avec une adresse HTTPS fournie, sans achat de domaine. `render.yaml` est prêt pour un service Node.js et un disque persistant. Cette offre est payante : préparer et vérifier la configuration, puis obtenir l’accord de l’utilisateur avant toute souscription ou activation coûteuse. Une autre offre peut être choisie en conservant la persistance des données et l’accès privé.

Prochaines étapes :

1. Lire les instructions et vérifier le checkout GitHub.
2. Vérifier les capacités de connexion à l’hébergeur disponibles dans la nouvelle tâche ; ne pas inventer un accès ou un lien public.
3. Terminer tout travail indépendant. Si l’accès manque, indiquer précisément qu’il faut un compte d’hébergement et les deux secrets dans ses réglages privés.
4. Après mise en ligne autorisée, vérifier création/connexion, sauvegarde et reconnexion, puis une vraie réponse IA. Une clé configurée ou un port ouvert ne suffisent pas.
5. Vérifier sur le vrai iPhone : Safari → Partager → Sur l’écran d’accueil → Ajouter.

SMS, WhatsApp, iMessage, notifications push, publication App Store et automatisation bancaire ne sont pas intégrés. Ne pas les présenter comme déjà disponibles.

## Exports et environnement cloud

`npm run release` génère `/workspace/outputs/CAP-application.tar.gz`. Un ZIP complet a aussi été préparé dans l’instance précédente. `npm run standalone` génère `CAP.html`, qui permet le tableau de bord sans serveur mais désactive explicitement la conversation.

Les binaires téléchargés, caches, processus, fichiers d’export et réglages de l’environnement cloud ne font pas partie du dépôt Git. Les scripts de préparation et de démarrage ont été enregistrés dans le brouillon de l’environnement précédent ; ne pas supposer qu’ils existent ou ont été exécutés dans une autre session. Publier ce brouillon ne publie pas un site web.

## Prompt prêt à utiliser dans Codex

> Reprends le projet CAP du dépôt elou76350-alt/ia-agent, branche main. Lis AGENTS.md et docs/CODEX-HANDOFF.md. L’application existe déjà ; vérifie son fonctionnement puis poursuis sa préparation à une mise en ligne privée HTTPS pour iPhone. Préserve le compte, le stockage chiffré et les protections. Ne me redemande pas mon téléphone ni mon métier. Termine les travaux possibles avec les accès disponibles et indique les prérequis externes restants. Ne prétends pas que l’IA ou le site sont en ligne sans test réel et n’active aucun service payant sans mon accord.
