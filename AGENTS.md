# Instructions pour Codex — CAP

Lire d’abord `docs/CODEX-HANDOFF.md`, puis `README.md`. Le projet existe déjà : le reprendre sans le réécrire intégralement.

## Objectif et utilisateur

- CAP est un assistant personnel francophone, destiné d’abord à un iPhone.
- Priorités : conversation, objectifs, finances, bien-être et progression professionnelle comme **Patient Experience Specialist**.
- L’utilisateur a demandé une application complète, puis son envoi sur GitHub. Le dépôt est `elou76350-alt/ia-agent`, branche distante `main`.
- L’utilisateur n’a ni hébergement ni domaine. Aucun service payant n’a été souscrit. La conversation IA réelle attend une clé API sécurisée et l’application n’a pas encore d’adresse publique.

## Travailler dans le dépôt

- Utiliser le checkout existant ; chaque tâche cloud est déjà isolée. Ne pas créer de worktree sans demande explicite.
- Utiliser **Node.js 24** : l’API importe `node:sqlite`.
- Installer avec `npm ci`, en conservant `package-lock.json`. Dans ce cloud, utiliser `--cache /workspace/.cache/npm` si le cache personnel n’est pas accessible.
- `npm run dev` démarre Vite sur 5173 et l’API sur 3001. Ne pas démarrer une seconde API si ce port est occupé par une instance connue de cette tâche.
- `npm run build` construit TypeScript, Vite et les ressources PWA. `npm start` sert la version compilée.
- Vérifier les changements avec les tests pertinents : `npm test`, `npm run test:e2e`, `npm run test:private`. Les tests navigateur cloud utilisent `/usr/bin/chromium` ; `CHROMIUM_PATH` permet un autre chemin.
- Une modification documentaire seule ne demande pas de reconstruire ni de répéter toutes les suites.

## Protéger le compte et les données

- Ne jamais committer de valeur secrète, `.env`, `.env.host`, base SQLite, `.workspace-key`, volume de données ou dossier médical. Les fichiers d’exemple restent sans valeurs confidentielles.
- Ne pas lire ni afficher les valeurs des variables secrètes pour diagnostiquer leur présence. Ne pas extraire les identifiants du proxy Git ; l’authentification GitHub existante fonctionne.
- `CAP_SETUP_CODE` est un secret local du processus serveur, pas un placeholder destiné à être substitué par un proxy réseau. Il autorise uniquement la création du premier propriétaire.
- En production, conserver `CAP_AUTH_ENABLED=1`, les cookies Secure, le contrôle d’origine et les routes de données protégées. Ne pas contourner un échec d’authentification.
- Préserver tout `CAP_DATA_DIR`, notamment la base et sa clé de chiffrement. Ne pas supprimer les données ou les volumes pour résoudre un problème de démarrage.
- Ne jamais mettre les API, sessions ou espaces privés dans le cache du service worker. Préserver les contrôles de révision et la gestion des conflits ; ne pas écraser les changements d’un autre appareil.
- Les secrets doivent être saisis dans les réglages sécurisés de l’environnement ou de l’hébergeur, jamais dans le chat ou dans une variable `VITE_`.

## Présenter honnêtement les capacités

- Sans `AGENT_API_KEY`, le mode découverte est déterministe : ne pas le présenter comme une vraie connexion IA.
- Le modèle par défaut est `gpt-5.4` avec raisonnement `high`, configurable. Vérifier sa disponibilité réelle pour le compte avant d’affirmer qu’il répond. Aucun « QI de 200 », résultat financier, guérison ou bonheur ne peut être garanti.
- Le journal n’est pas ajouté automatiquement aux requêtes IA. Le contexte de profil, budget et objectifs nécessite l’option explicite de partage.
- CAP n’exécute aucun paiement, diagnostic ou envoi de candidature. SMS, WhatsApp et iMessage ne sont pas intégrés.
- Une PWA installable depuis Safari ne constitue pas une publication dans l’App Store. Un build réussi ne prouve ni un déploiement public ni un fonctionnement sur un vrai iPhone.
- La publication de l’environnement cloud ne publie pas le site web. Ne pas inventer de lien public ou de nouvelle tâche Codex.
- Ne pas désactiver TLS, les contrôles d’intégrité ou les restrictions d’hôte pour rendre un test passant. Le Dockerfile accepte une CA publique de confiance via le secret BuildKit facultatif `cap_build_ca` lorsque le proxy du cloud le nécessite.

## Déploiement

**Nouvelle préférence confirmée : budget 0 €, publication gratuite.** Lire `docs/GRATUIT-CLOUDFLARE.md` avant de proposer Render. `wrangler.jsonc` configure Workers Free, D1 et Workers AI ; le backend est `cloudflare/index.mjs` / `cloudflare/worker.mjs`. Le modèle gratuit n’est pas GPT-5.4 et aucune clé OpenAI n’est nécessaire dans cette variante. Les quotas gratuits s’appliquent, CAP limite en plus les tentatives à 30 par jour UTC et n’active pas de fournisseur payant en secours. Ne pas activer Workers Paid ni une offre premium.

Le compte Cloudflare n’est pas connecté ; aucun lien public ni appel réel Workers AI n’a encore été vérifié. Les secrets Cloudflare `CAP_SETUP_CODE` et `CAP_DATA_KEY` sont locaux au processus Worker, pas des placeholders de proxy. Ne pas modifier la clé d’une base existante. La version Node conserve le chiffrement sur disque et son fonctionnement précédent.

Lire `docs/HEBERGEMENT-SIMPLE.md` pour le chemin Render et `docs/DEPLOIEMENT.md` pour Docker/Caddy. Le plan Render avec disque persistant est payant ; une création de service ou souscription n’a pas encore été autorisée. Préparer un résultat vérifiable avant de demander une éventuelle activation payante.

Terminer les travaux indépendants sans attendre les accès manquants. Distinguer toujours le code préparé, les tests réellement exécutés, la configuration enregistrée et la mise en ligne effective.
