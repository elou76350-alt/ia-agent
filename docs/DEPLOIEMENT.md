# Mettre CAP sur son téléphone

CAP est une application web installable. Une fois hébergée en HTTPS, elle s’ouvre sur iPhone depuis Safari et peut être ajoutée à l’écran d’accueil. Elle n’a pas besoin d’une publication sur l’App Store. Les appels IA utilisent le serveur ; la clé API ne se trouve jamais dans l’application téléchargée.

Cette procédure prépare une instance personnelle, avec un seul propriétaire. Les connexions SMS, WhatsApp et iMessage ne sont pas incluses.

## Ce qu’il faut fournir

- Un serveur Linux avec Docker Engine et le plugin Docker Compose, accessible sur les ports 80 et 443.
- Un nom de domaine ou sous-domaine dont les enregistrements DNS pointent vers ce serveur. `CAP_DOMAIN` doit contenir uniquement ce nom, sans `https://`, port ni chemin.
- Une clé API OpenAI disposant d’un accès au modèle choisi et d’un crédit disponible. Un abonnement à l’application ChatGPT ne fournit pas automatiquement ces crédits API.
- Un code de configuration long, aléatoire et privé pour créer le compte propriétaire à la première ouverture. Le choisir dans un gestionnaire de mots de passe et ne pas l’envoyer dans une conversation.

Le déploiement engage les ressources de l’hébergeur et les coûts du fournisseur IA. Aucun compte, abonnement, domaine ou déploiement externe n’est créé automatiquement par ces fichiers.

## 1. Préparer le serveur

Copier le projet sur le serveur et se placer dans son dossier. Créer un fichier privé `.env.host`, qui n’est pas ajouté à Git et ne doit pas être transmis :

```dotenv
CAP_DOMAIN=cap.votre-domaine.fr
AGENT_API_KEY=
CAP_SETUP_CODE=
AGENT_MODEL=gpt-5.4
AGENT_REASONING_EFFORT=high
```

Saisir les deux secrets directement sur le serveur ou au moyen de son gestionnaire de secrets, puis protéger le fichier :

```sh
chmod 600 .env.host
docker compose --env-file .env.host config --quiet
```

`config --quiet` vérifie la configuration sans afficher ses valeurs. Ne pas utiliser une sortie de configuration complète dans un ticket ou une conversation : elle peut contenir des secrets.

L’accès HTTPS sortant à `api.openai.com` est nécessaire à l’IA. Caddy doit pouvoir joindre les autorités de certification pour délivrer et renouveler son certificat. Le téléchargement des images et dépendances nécessite aussi les registres Docker et npm.

## 2. Construire et démarrer

```sh
docker compose --env-file .env.host up -d --build
docker compose --env-file .env.host ps
```

La construction utilise les versions verrouillées dans `package-lock.json`. Les clés ne sont utilisées qu’au démarrage du conteneur, pas durant la construction. Le service applicatif écoute seulement sur le réseau de Docker ; Caddy publie les ports 80 et 443 et fournit HTTPS.

Si l’environnement de construction utilise un proxy d’entreprise avec une autorité de certification déjà approuvée sur le serveur, transmettre son certificat public comme montage temporaire de construction. Par exemple, lorsque `NODE_EXTRA_CA_CERTS` pointe déjà vers ce certificat approuvé :

```sh
docker build --secret id=cap_build_ca,src="$NODE_EXTRA_CA_CERTS" -t cap-personal-assistant:local .
docker compose --env-file .env.host up -d --no-build
```

Ce montage est optionnel, n’est pas conservé dans l’image et ne désactive ni TLS ni la vérification d’intégrité des dépendances. Ne pas utiliser `strict-ssl=false` ou un certificat de provenance inconnue pour contourner une erreur. Si le proxy s’applique également aux appels du serveur en production, son accès et son certificat approuvé doivent être configurés par l’administrateur sur l’hébergement ; le montage de construction ne configure pas automatiquement le réseau de l’application.

Les données de compte et les sauvegardes de l’espace sont conservées dans le volume `cap_app_data`, monté dans `/data`. Le volume contient aussi la clé locale nécessaire au déchiffrement des sauvegardes. Ne pas utiliser `docker compose down --volumes` pour une simple mise à jour : cette commande détruirait les volumes.

## 3. Créer son compte et vérifier la conversation

Ouvrir l’adresse HTTPS du domaine dans Safari. À la première ouverture, l’écran de configuration demande le code de configuration, un identifiant et un mot de passe personnel d’au moins 12 caractères. Le code sert uniquement à autoriser cette première création. Il ne remplace pas le mot de passe de connexion et ne permet pas de créer un second propriétaire.

Une fois le compte créé, le code de configuration peut être retiré de `.env.host`, puis l’application redémarrée :

```sh
docker compose --env-file .env.host up -d
```

Vérifier les capacités réelles :

1. La page de connexion est présentée dans une fenêtre privée, sans exposition du budget ou du journal.
2. Après connexion, un objectif créé reste présent après déconnexion et reconnexion, puis depuis un autre appareil connecté au même compte.
3. La conversation répond à un message réel et passe de « IA configurée » à « IA connectée ». Une clé configurée ou une réponse de `/api/health` ne suffit pas à prouver que le fournisseur répond.
4. Le bouton de déconnexion ferme l’accès au compte. Les API de données et de conversation refusent les requêtes sans session.

Le mode de raisonnement approfondi peut demander jusqu’à 90 secondes. Une erreur de crédit, de modèle, de réseau ou d’authentification fournisseur est affichée sans fausse réponse de remplacement.

## 4. Installer sur iPhone

Dans Safari, ouvrir le domaine HTTPS, toucher **Partager**, puis **Sur l’écran d’accueil** et **Ajouter**. Si l’option d’ouverture comme application web est proposée, la laisser activée. L’icône CAP ouvre alors une fenêtre dédiée.

La conversation libre et la synchronisation nécessitent Internet. Le cache de l’application conserve uniquement les ressources de l’interface, sans réponses API ni journal. L’installation n’active pas les SMS ni les notifications système à elle seule.

## Mettre à jour

Avant une mise à jour, réaliser une sauvegarde du volume de données. Copier les sources de la nouvelle version puis exécuter :

```sh
docker compose --env-file .env.host up -d --build
```

Les volumes existants sont conservés. Si CAP propose une mise à jour de son interface, terminer l’action en cours avant de la charger. Vérifier ensuite la connexion, une sauvegarde et une réponse IA.

## Sauvegarde et protection des données

Exporter les données de l’espace depuis les préférences pour conserver une copie lisible. Ce fichier est sensible et doit être protégé. Pour une sauvegarde technique complète, utiliser la fonction de sauvegarde de volumes de l’hébergeur, en arrêtant d’abord le service applicatif pour obtenir une copie cohérente de la base SQLite :

```sh
docker compose --env-file .env.host stop app
# Réaliser la sauvegarde du volume cap_app_data avec l’outil de l’hébergeur.
docker compose --env-file .env.host start app
```

La sauvegarde doit inclure la base et sa clé de chiffrement locale. Perdre cette clé rend les données chiffrées irrécupérables. Conserver les sauvegardes dans un stockage privé et chiffré, puis tester une restauration sur une instance séparée avant d’en dépendre.

Les mots de passe sont hachés ; les sessions sont des cookies HttpOnly et les données sauvegardées côté serveur sont chiffrées. Le propriétaire du serveur peut toutefois accéder au volume contenant la base et sa clé : ce mécanisme ne protège pas contre une compromission de l’hébergement. Le navigateur conserve aussi les données autorisées par l’application ; elles ne constituent pas un coffre-fort médical. Ne pas saisir de données permettant d’identifier des patients.

## Diagnostic

- **Le domaine ne répond pas** : vérifier DNS, pare-feu, ports 80/443, puis l’état des conteneurs. L’émission du premier certificat peut prendre un moment.
- **Configuration du propriétaire indisponible** : vérifier que `CAP_SETUP_CODE` a été renseigné avant la première création de compte, puis redémarrer le service.
- **Connexion IA refusée** : vérifier la clé, les crédits et l’accès au modèle côté fournisseur. Ne jamais coller la clé dans le chat.
- **Conflit de sauvegarde** : terminer la sauvegarde sur l’autre appareil, puis utiliser l’action de rechargement proposée ; ne pas écraser silencieusement les données.
- **Interface ancienne** : utiliser l’action de mise à jour ou recharger la page après avoir vérifié l’état de synchronisation.

Les logs de démarrage peuvent aider au diagnostic, mais ne doivent pas contenir de messages, mots de passe ou secrets. Ce guide ne prouve pas qu’un serveur externe a été déployé : la mise en ligne et un test avec une vraie clé doivent être réalisés sur l’hébergement choisi.
