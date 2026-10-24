# Mettre CAP en ligne sans acheter de domaine

Le dépôt contient une configuration `render.yaml` pour un service Node.js géré par Render. L’hébergeur attribue une adresse HTTPS ; aucun achat de domaine n’est nécessaire. Les fichiers sont préparés, mais aucun compte, service, paiement ou déploiement Render n’a été créé ou testé dans un compte externe.

**Le service Starter et son disque persistant sont payants.** Vérifier le tarif présenté par Render avant de valider. Les appels à OpenAI sont également facturés séparément. Un abonnement ChatGPT n’inclut pas automatiquement les crédits API.

## Étapes à effectuer dans les comptes personnels

1. Créer ou connecter un compte Render depuis son site officiel. La création du compte seule ne déploie pas CAP.
2. Placer les fichiers du projet dans un dépôt Git connecté à ce compte. Les fichiers créés localement ne sont pas envoyés automatiquement sur GitHub ; l’archive complète contient le projet à importer.
3. Dans Render, créer un **Blueprint** à partir de ce dépôt et vérifier les ressources proposées par `render.yaml`. Ne confirmer les ressources payantes qu’après examen de leur coût.
4. Saisir `AGENT_API_KEY` dans les réglages privés du service, ainsi que `CAP_SETUP_CODE`, un code privé aléatoire d’au moins 16 caractères choisi dans un gestionnaire de mots de passe. Ne jamais les envoyer dans une conversation ni les ajouter au dépôt. Render fournit directement ces variables au processus serveur ; le code de configuration ne doit pas être un placeholder de proxy réseau.
5. Lancer le déploiement. Le serveur utilise le port fourni par Render et conserve le compte et l’espace dans le disque monté à `/var/data`. Ne pas supprimer ou détacher ce disque pour corriger une erreur.
6. Ouvrir l’adresse HTTPS attribuée. Créer le compte propriétaire en saisissant le code de configuration, un identifiant et un mot de passe d’au moins 12 caractères. Le code initial peut ensuite être retiré des variables du service.
7. Créer un objectif, se déconnecter puis se reconnecter pour vérifier sa sauvegarde. Tester une véritable réponse IA : « IA configurée » signifie seulement qu’une clé est renseignée ; « IA connectée » apparaît après une réponse réussie.
8. Sur iPhone, ouvrir cette adresse dans **Safari → Partager → Sur l’écran d’accueil → Ajouter**.

La configuration gérée utilise le contrôle d’origine de l’application et les cookies Secure en production. Si la plateforme modifie l’en-tête Host et refuse les requêtes, définir `APP_ORIGIN` avec l’adresse HTTPS exacte du service, sans barre finale, puis redéployer. Ne pas désactiver les protections d’origine pour corriger ce problème.

## Données et limites

Sauvegarder tout le dossier `/var/data/cap`, notamment la base et `.workspace-key`. Sans cette clé, la base chiffrée ne peut plus être lue. Conserver aussi une exportation privée depuis les préférences de CAP. Les modifications hors connexion non encore synchronisées restent en mémoire ; les exporter avant de quitter en cas d’échec de sauvegarde.

Le chemin Docker avec proxy HTTPS reste disponible dans `DEPLOIEMENT.md` pour un autre hébergeur. Les SMS et WhatsApp ne sont pas inclus. L’installation réelle sur un iPhone et l’accès au fournisseur doivent être vérifiés après la mise en ligne.
