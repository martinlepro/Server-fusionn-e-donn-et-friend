// server.js (Code fusionné pour gérer les amis et les données de jeu avec Firebase)
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid'; // Pour la création d'IDs uniques si nécessaire

// Charger les variables d'environnement
dotenv.config();

// Initialisation du SDK Firebase Admin
const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!serviceAccountKey) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set.');
    process.exit(1);
}

let db;
try {
    const serviceAccount = JSON.parse(serviceAccountKey);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL || "https://dino-meilleur-score-classement-default-rtdb.europe-west1.firebasedatabase.app"
    });
    console.log('Firebase Admin SDK initialized successfully!');
    db = admin.database();
} catch (error) {
    console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY or initialize Firebase Admin SDK:', error);
    process.exit(1);
}

// Configuration de l'application Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Fonction utilitaire pour envoyer des réponses API cohérentes
const sendResponse = (res, statusCode, success, message, data = null) => {
    res.status(statusCode).json({ success, message, data });
};

// --- ENDPOINTS DU SYSTÈME D'AMIS (déjà dans le server.js original) ---

app.post('/findOrCreateUser', async (req, res) => {
    const { pseudo } = req.body;
    if (!pseudo || pseudo.trim() === '') {
        return sendResponse(res, 400, false, 'Le pseudo est requis et ne peut pas être vide.');
    }
    try {
        const snapshot = await db.ref('users').orderByChild('pseudo').equalTo(pseudo).limitToFirst(1).once('value');
        if (snapshot.exists()) {
            const existingUserId = Object.keys(snapshot.val())[0];
            const existingUserData = snapshot.val()[existingUserId];
            console.log(`Utilisateur existant trouvé: ${existingUserData.pseudo} (${existingUserId})`);
            return sendResponse(res, 200, true, 'Utilisateur trouvé et connecté.', { id: existingUserId, pseudo: existingUserData.pseudo });
        } else {
            const newUserId = uuidv4(); // Utilise un ID unique
            const newUserRef = db.ref('users').child(newUserId);
            await newUserRef.set({
                userId: newUserId,
                pseudo: pseudo,
                profile: { bio: "", avatarUrl: "", customStatus: "" },
                gameData: { mainScore: 0, level: 0 }, // Ajout des champs de données de jeu
                friends: {},
                friendRequestsReceived: {},
                friendRequestsSent: {},
                createdAt: admin.database.ServerValue.TIMESTAMP
            });
            console.log(`Nouvel utilisateur créé: ${pseudo} (${newUserId})`);
            return sendResponse(res, 201, true, 'Nouvel utilisateur créé avec succès !', { id: newUserId, pseudo: pseudo });
        }
    } catch (error) {
        console.error('Erreur lors de la recherche ou création de l\'utilisateur :', error);
        sendResponse(res, 500, false, 'Échec de la recherche ou création de l\'utilisateur.', { error: error.message });
    }
});

// GET /getUserDetails/:id (inchangé)
app.get('/getUserDetails/:id', async (req, res) => {
    const userId = req.params.id;
    if (!userId) return sendResponse(res, 400, false, 'L\'ID utilisateur est requis.');
    try {
        const snapshot = await db.ref(`users/${userId}`).once('value');
        if (!snapshot.exists()) return sendResponse(res, 404, false, 'Utilisateur non trouvé.');
        const userData = snapshot.val();
        sendResponse(res, 200, true, 'Détails de l\'utilisateur récupérés.', { id: userId, pseudo: userData.pseudo });
    } catch (error) {
        console.error('Erreur lors de la récupération des détails de l\'utilisateur :', error);
        sendResponse(res, 500, false, 'Échec de la récupération des détails de l\'utilisateur.', { error: error.message });
    }
});

// ... Tous les autres endpoints du système d'amis (`sendFriendRequest`, `acceptFriendRequest`, etc.) sont inchangés et peuvent être copiés ici. ...

// --- NOUVEAUX ENDPOINTS POUR LES DONNÉES DE JEU (Adaptés de server_game_api.js) ---

// Endpoint pour le classement
app.get("/api/leaderboard", async (req, res) => {
    console.log("--> Requête GET sur /api/leaderboard");
    try {
        const snapshot = await db.ref('users').orderByChild('gameData/mainScore').once('value');
        if (!snapshot.exists()) {
            return res.status(200).json([]);
        }
        const leaderboard = [];
        snapshot.forEach(childSnapshot => {
            const userData = childSnapshot.val();
            leaderboard.push({
                userId: childSnapshot.key,
                username: userData.pseudo,
                profile: userData.profile,
                gameData: userData.gameData
            });
        });
        // La requête orderByChild renvoie déjà les données triées. On inverse l'ordre pour avoir le plus grand score en premier.
        res.status(200).json(leaderboard.reverse());
    } catch (error) {
        console.error('Erreur lors de la récupération du classement :', error);
        res.status(500).send("Échec de la récupération du classement.");
    }
});

// Endpoint pour vérifier l'existence d'un utilisateur et récupérer ses infos
app.get("/api/users/:userId", async (req, res) => {
    const { userId } = req.params;
    console.log(`--> Requête GET sur /api/users/${userId}`);
    try {
        const snapshot = await db.ref(`users/${userId}`).once('value');
        if (snapshot.exists()) {
            res.status(200).json(snapshot.val());
        } else {
            res.status(404).send("Utilisateur non trouvé.");
        }
    } catch (error) {
        console.error('Erreur lors de la récupération de l\'utilisateur :', error);
        res.status(500).send("Erreur serveur lors de la récupération de l'utilisateur.");
    }
});

// Endpoint pour récupérer toutes les données de jeu d'un utilisateur
app.get("/api/users/:userId/gameData", async (req, res) => {
    const { userId } = req.params;
    console.log(`--> Requête GET sur /api/users/${userId}/gameData`);
    try {
        const snapshot = await db.ref(`users/${userId}/gameData`).once('value');
        if (snapshot.exists()) {
            res.status(200).json(snapshot.val());
        } else {
            res.status(200).json({});
        }
    } catch (error) {
        console.error('Erreur lors de la récupération des données de jeu :', error);
        res.status(500).send("Erreur serveur lors de la récupération des données de jeu.");
    }
});

// Endpoint pour récupérer la valeur d'un champ de donnée de jeu spécifique
app.get("/api/users/:userId/gameData/:fieldName", async (req, res) => {
    const { userId, fieldName } = req.params;
    console.log(`--> Requête GET sur /api/users/${userId}/gameData/${fieldName}`);
    try {
        const snapshot = await db.ref(`users/${userId}/gameData/${fieldName}`).once('value');
        if (snapshot.exists()) {
            res.status(200).json(snapshot.val());
        } else {
            res.status(404).send(`Champ de donnée '${fieldName}' non trouvé pour l'utilisateur '${userId}'.`);
        }
    } catch (error) {
        console.error('Erreur lors de la récupération du champ de donnée :', error);
        res.status(500).send("Erreur serveur lors de la récupération du champ de donnée.");
    }
});

// Endpoint pour créer ou mettre à jour un champ de donnée de jeu
app.post("/api/users/:userId/gameData", async (req, res) => {
    const { userId } = req.params;
    const { field, value } = req.body;
    console.log(`--> Requête POST sur /api/users/${userId}/gameData pour ${field}: ${value}`);

    if (!field || typeof value === "undefined") {
        return res.status(400).send("Champ ou valeur manquante dans la requête.");
    }
    
    try {
        const userRef = db.ref(`users/${userId}`);
        const userSnapshot = await userRef.once('value');
        if (!userSnapshot.exists()) {
            return res.status(404).send("Utilisateur non trouvé.");
        }

        const updates = {};
        updates[`gameData/${field}`] = value;
        await userRef.update(updates);
        res.status(200).send(`Donnée de jeu '${field}' de l'utilisateur '${userId}' mise à jour à '${value}'.`);
    } catch (error) {
        console.error('Erreur lors de la mise à jour des données de jeu :', error);
        res.status(500).send("Erreur serveur lors de la mise à jour des données de jeu.");
    }
});

// Endpoint pour renommer un champ de donnée de jeu
app.post("/api/users/:userId/rename-game-field", async (req, res) => {
    const { userId } = req.params;
    const { oldField, newField } = req.body;
    console.log(`--> Requête POST sur /api/users/${userId}/rename-game-field pour ${oldField} -> ${newField}`);

    if (!oldField || !newField) {
        return res.status(400).send("Ancien ou nouveau nom de champ manquant.");
    }

    try {
        const userRef = db.ref(`users/${userId}`);
        const userSnapshot = await userRef.once('value');
        if (!userSnapshot.exists()) {
            return res.status(404).send("Utilisateur non trouvé.");
        }
        
        const gameDataSnapshot = await userRef.child('gameData').once('value');
        const gameData = gameDataSnapshot.val();

        if (!gameData || !gameData.hasOwnProperty(oldField)) {
            return res.status(404).send(`Ancien champ de donnée '${oldField}' non trouvé pour l'utilisateur '${userId}'.`);
        }

        const updates = {};
        updates[`gameData/${newField}`] = gameData[oldField];
        updates[`gameData/${oldField}`] = null; // null pour supprimer l'ancien champ
        await userRef.update(updates);

        res.status(200).send(`Champ de donnée '${oldField}' de l'utilisateur '${userId}' renommé en '${newField}'.`);
    } catch (error) {
        console.error('Erreur lors du renommage du champ :', error);
        res.status(500).send("Erreur serveur lors du renommage du champ.");
    }
});


// ... Tous les autres endpoints du système d'amis doivent être copiés ici. ...


// Gestionnaire d'erreur global
app.use((err, req, res, next) => {
    console.error(err.stack);
    sendResponse(res, 500, false, 'Une erreur interne du serveur est survenue.', { error: err.message || 'Erreur inconnue du serveur.' });
});

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`🚀 Serveur API unifié démarré sur http://localhost:${PORT}`);
});
