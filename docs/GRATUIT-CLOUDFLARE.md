# CAP sur une offre gratuite

Cette variante utilise **Cloudflare Workers Free**, **D1** pour le stockage persistant et **Workers AI** dans son quota gratuit. Une adresse HTTPS `workers.dev` est fournie : aucun achat de domaine et aucune clé API OpenAI ne sont nécessaires.

**État actuel : code préparé et testé localement, pas encore publié dans un compte Cloudflare.** La connexion de ce compte n’est pas disponible dans l’environnement de préparation. Ne pas confondre la compilation ou les tests locaux avec une adresse publique accessible.

## Garder un coût de 0 €

Rester sur **Workers Free**. Ne pas activer Workers Paid, de modèle premium, d’AI Gateway prépayé ou d’abonnement Render. Sur le plan gratuit, les opérations sont bloquées lorsque les quotas sont épuisés ; l’application ne demande pas de passage au payant et n’appelle pas OpenAI en remplacement.

Les quotas officiels consultés le 24 octobre 2026 comprennent 100 000 requêtes Workers par jour et 10 000 Neurons Workers AI par jour, avec des limites séparées pour D1. Ils peuvent évoluer et sont partagés avec les autres applications du compte. CAP réserve en plus au maximum **30 tentatives de réponse par jour UTC**, dix par minute, et borne la taille des conversations et des réponses. Une tentative qui échoue peut consommer le quota. Le quota du fournisseur peut être épuisé avant ces trente tentatives.

Le modèle gratuit choisi est `@cf/meta/llama-3.1-8b-instruct-fp8-fast`. Ce n’est pas GPT-5.4 : ses capacités, la disponibilité et la précision diffèrent. La limite de temps CPU du plan Workers Free est de 10 ms par requête ; la création et la connexion du compte utilisent scrypt et devront aussi être vérifiées sur le vrai compte Free. Ne pas affaiblir les mots de passe ni activer un plan payant si la plateforme refuse une requête.

Sources officielles : [Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/), [limites Workers](https://developers.cloudflare.com/workers/platform/limits/), [D1](https://developers.cloudflare.com/d1/platform/pricing/).

## Publier depuis le navigateur

1. Créer un compte sur [Cloudflare](https://dash.cloudflare.com/) et conserver le plan gratuit.
2. Dans **Workers & Pages**, créer une application en important le dépôt GitHub `elou76350-alt/ia-agent`. Autoriser uniquement l’accès au dépôt voulu. Si le dépôt est public, le bouton officiel [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/elou76350-alt/ia-agent) constitue aussi un point d’entrée ; il peut créer une copie du dépôt dans le compte Git connecté.
3. Utiliser la configuration `wrangler.jsonc`. Le build est `npm run build` et le déploiement utilise Wrangler. La base D1 `DB` doit être provisionnée et liée au Worker ; Wrangler récent sait provisionner une base dont l’identifiant n’est pas encore renseigné. Ne pas remplacer une base existante ou effacer ses données pour résoudre une erreur.
4. Dans les secrets privés du Worker, renseigner **CAP_SETUP_CODE**, un code aléatoire d’au moins 16 caractères, et **CAP_DATA_KEY**, une clé aléatoire d’au moins 32 caractères. Les choisir dans un gestionnaire de mots de passe et en garder une copie privée, en particulier la clé de chiffrement. Ne pas les ajouter au dépôt ni les envoyer dans une conversation. Les champs `secrets.required` les déclarent pour les outils de déploiement.
5. Vérifier que la liaison **AI** pointe vers Workers AI, sans offre premium ou passerelle payante, puis publier. Le code initialise le schéma D1 avec des créations de tables idempotentes, sans effacer d’espace existant. L’URL HTTPS est celle affichée par Cloudflare après réussite ; elle n’est pas inventée ou prédéfinie dans le projet.
6. Ouvrir cette URL. Créer le compte propriétaire avec le code privé, un identifiant et un mot de passe de 12 caractères minimum. Le code de création peut être retiré après cette étape ; **conserver la clé de chiffrement**.
7. Tester un objectif, la déconnexion/reconnexion et une vraie réponse IA. La présence de la liaison AI ne prouve pas une réponse réussie. Tester également les limites de ressources du plan Free sur cette instance avant d’y conserver des informations importantes.
8. Sur iPhone : ouvrir l’adresse dans **Safari → Partager → Sur l’écran d’accueil → Ajouter**.

Les écrans exacts de Cloudflare peuvent évoluer. Si une ressource ou une étape demande d’activer une offre payante, ne pas confirmer : le budget autorisé est de 0 €.

## Alternative depuis son ordinateur

Utiliser Node.js 24 :

```sh
npm ci
npx wrangler login
npm run cf:check
npm run cf:deploy -- --secrets-file .dev.vars
```

Avant le premier déploiement, créer un fichier local privé `.dev.vars` contenant les deux secrets ci-dessus, choisi par l’utilisateur. Ce fichier est ignoré par Git. L’option `--secrets-file` permet de les fournir lors de la première publication ; un Worker inexistant ne peut pas recevoir des secrets séparément avant sa création. Ne jamais recopier les valeurs dans les commandes, les journaux ou le chat. L’authentification `wrangler login` se termine dans le navigateur du propriétaire, pas dans une session d’un autre compte.

Dans le cloud de préparation, les répertoires personnels sont parfois non inscriptibles. Pour une vérification locale seulement, `XDG_CONFIG_HOME=/workspace/.cache/cloudflare` et `WRANGLER_LOG_PATH=/tmp/cap-wrangler.log` évitent de modifier le répertoire personnel. Ne pas utiliser un nouveau répertoire de configuration pour ignorer une authentification déjà disponible.

## Confidentialité et persistance

- Authentification obligatoire, sessions privées, mots de passe hachés avec scrypt et contrôle des origines, comme dans la variante Node.
- Espace chiffré en AES-256-GCM dans D1 ; contrôle de révision pour les conflits. Le service worker ne cache aucune API ni donnée privée.
- `CAP_DATA_KEY` permet le déchiffrement : la modifier ou la perdre empêche de lire l’espace existant. L’application refuse les écritures si l’empreinte de cette clé a changé. Faire des exports privés et sauvegarder la base D1 avec sa clé conservée séparément.
- Le passage depuis une installation SQLite locale n’est pas une migration automatique. Aucune base locale ni clé de stockage existante n’est supprimée ou envoyée automatiquement à D1.
- Seuls les messages envoyés et le contexte explicitement coché sont transmis à Cloudflare Workers AI ; pas le journal automatiquement. Aucun mot de passe ou code de création n’est transmis au modèle. Les conditions du fournisseur s’appliquent au traitement des messages.
- Les appels aux modèles sont simulés dans les tests automatiques. Aucun appel réel Workers AI ni installation sur un iPhone physique ne sont validés avant le déploiement dans le compte utilisateur.

La variante Node/Docker et `render.yaml` restent disponibles comme alternatives ; elles ne sont pas activées par ce guide et ne doivent pas être choisies pour l’objectif actuel de gratuité.
