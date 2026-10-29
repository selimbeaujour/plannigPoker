# Planning Poker Fibonacci

Site de planning poker multi-utilisateurs : chaque participant ouvre le lien, choisit une carte de la suite de Fibonacci (0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89 ou « ? »), et les votes restent cachés jusqu'à la révélation.

- Aucun compte nécessaire : on entre juste son prénom.
- Une salle par lien (`?salle=xxxxxx`), créée automatiquement à la première visite.
- Les votes sont gardés sur le serveur et ne sont envoyés aux navigateurs qu'après la révélation : personne ne peut tricher.
- Résultats : moyenne, médiane, valeur Fibonacci la plus proche, répartition, consensus ou écart.
- Historique des tickets estimés dans la salle.
- Aucune dépendance npm : uniquement Node.js 18 ou plus récent.

## Essayer sur votre ordinateur

```bash
cd planning-poker
npm start
```

Ouvrez http://localhost:3000. Pour simuler un deuxième participant, ouvrez le même lien dans une fenêtre de navigation privée.

## Mettre en ligne gratuitement sur Render (lien https)

1. **Créez un dépôt GitHub** : sur https://github.com/new, créez un dépôt (par exemple `planning-poker`), puis cliquez « uploading an existing file » et déposez tout le contenu du dossier (`server.js`, `websocket.js`, `package.json`, `README.md` et le dossier `public`).
2. **Créez un compte sur https://render.com** et connectez-le à GitHub.
3. Cliquez **New → Web Service**, choisissez votre dépôt, puis réglez :
   - Runtime : **Node**
   - Build Command : `npm install`
   - Start Command : `npm start`
   - Instance Type : **Free**
4. Cliquez **Deploy**. Après une ou deux minutes, Render affiche votre adresse, du type `https://planning-poker-xxxx.onrender.com`.
5. Ouvrez-la, entrez votre prénom, puis cliquez **Copier le lien d'invitation** et envoyez ce lien à votre équipe.

Le fichier `render.yaml` permet aussi un déploiement en un clic via **New → Blueprint**.

### À savoir sur l'offre gratuite de Render

- Le serveur se met en veille après 15 minutes sans visite. La première ouverture suivante prend environ une minute.
- Les salles sont gardées en mémoire : un redémarrage ou une mise en veille efface les votes et l'historique en cours. Pour une session de planning, ce n'est pas gênant.
- Pour éviter la veille, passez sur une instance payante (environ 7 $ par mois).

## Autres hébergeurs possibles

Le serveur lit le port dans la variable `PORT` et fonctionne tel quel sur Railway, Fly.io, Koyeb, un VPS ou tout hébergeur Node.js qui accepte les WebSockets.

## Structure

```
server.js        serveur HTTP, salles et logique de vote
websocket.js     serveur WebSocket minimal sans dépendance
public/index.html  interface (HTML, CSS et JavaScript)
render.yaml      configuration Render
```
