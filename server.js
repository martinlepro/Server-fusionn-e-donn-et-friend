// server.js (Code fusionné pour gérer les amis et les données de jeu avec Firebase)

// 1. Import des modules nécessaires
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

// 2. Charger les variables d'environnement
dotenv.config();

// 3. Initialisation du SDK Firebase Admin
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

// 4. Configuration de l'application Express
const app = express();
const PORT = process.env.PORT || 3000;

// 5. Middleware
app.use(cors());
app.use(express.json());

// 6. Fonction utilitaire pour envoyer des réponses API cohérentes
const sendResponse = (res, statusCode, success, message, data = null) => {
    res.status(statusCode).json({ success, message, data });
};

// --- ENDPOINTS DU SYSTÈME D'AMIS ---

// Endpoint pour CRÉER un nouvel utilisateur (permet les doublons de pseudos)
app.post('/createUser', async (req, res) => {
    const { pseudo } = req.body;
    if (!pseudo || pseudo.trim() === '') {
        return sendResponse(res, 400, false, 'Le pseudo est requis et ne peut pas être vide.');
    }
    try {
        const newUserId = uuidv4();
        const newUserRef = db.ref('users').child(newUserId);
        
        await newUserRef.set({
            userId: newUserId,
            pseudo: pseudo,
            profile: { bio: "", avatarUrl: "", customStatus: "" },
            gameData: { mainScore: 0, level: 0 },
            friends: {},
            friendRequestsReceived: {},
            friendRequestsSent: {},
            createdAt: admin.database.ServerValue.TIMESTAMP
        });
        
        console.log(`Nouvel utilisateur créé: ${pseudo} (${newUserId})`);
        sendResponse(res, 201, true, 'Nouvel utilisateur créé avec succès !', { id: newUserId, pseudo: pseudo });

    } catch (error) {
        console.error('Erreur lors de la création de l\'utilisateur :', error);
        sendResponse(res, 500, false, 'Échec de la création de l\'utilisateur.', { error: error.message });
    }
});


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

app.post('/sendFriendRequest', async (req, res) => {
    const { userId, friendId } = req.body;
    if (!userId || !friendId) return sendResponse(res, 400, false, 'L\'ID utilisateur et l\'ID ami sont requis.');
    if (userId === friendId) return sendResponse(res, 400, false, 'Impossible d\'envoyer une demande d\'ami à soi-même.');
    try {
        const updates = {};
        updates[`users/${userId}/friendRequestsSent/${friendId}`] = true;
        updates[`users/${friendId}/friendRequestsReceived/${userId}`] = true;
        await db.ref().update(updates);
        sendResponse(res, 200, true, 'Demande d\'ami envoyée avec succès.');
    } catch (error) {
        console.error('Erreur lors de l\'envoi de la demande d\'ami :', error);
        sendResponse(res, 500, false, 'Échec de l\'envoi de la demande d\'ami.', { error: error.message });
    }
});

app.get('/getFriendRequests/:id', async (req, res) => {
    const userId = req.params.id;
    if (!userId) return sendResponse(res, 400, false, 'L\'ID utilisateur est requis.');
    try {
        const snapshot = await db.ref(`users/${userId}/friendRequestsReceived`).once('value');
        if (!snapshot.exists()) {
            return sendResponse(res, 200, true, 'Aucune demande d\'ami.', []);
        }
        const requestsReceivedIds = Object.keys(snapshot.val());
        const requestsWithDetailsPromises = requestsReceivedIds.map(async (id) => {
            const userSnapshot = await db.ref(`users/${id}/pseudo`).once('value');
            if (userSnapshot.exists()) {
                return { id: id, pseudo: userSnapshot.val() };
            }
            return null;
        });
        const friendRequestsWithDetails = (await Promise.all(requestsWithDetailsPromises)).filter(Boolean);
        sendResponse(res, 200, true, 'Demandes d\'amis récupérées.', friendRequestsWithDetails);
    } catch (error) {
        console.error('Erreur lors de la récupération des demandes d\'amis :', error);
        sendResponse(res, 500, false, 'Échec de la récupération des demandes d\'amis.', { error: error.message });
    }
});

app.post('/acceptFriendRequest', async (req, res) => {
    const { userId, friendId } = req.body;
    if (!userId || !friendId) return sendResponse(res, 400, false, 'L\'ID utilisateur et l\'ID ami sont requis.');
    try {
        const updates = {};
        updates[`users/${userId}/friends/${friendId}`] = true;
        updates[`users/${friendId}/friends/${userId}`] = true;
        updates[`users/${userId}/friendRequestsReceived/${friendId}`] = null;
        updates[`users/${friendId}/friendRequestsSent/${userId}`] = null;
        await db.ref().update(updates);
        sendResponse(res, 200, true, 'Demande d\'ami acceptée avec succès !');
    } catch (error) {
        console.error('Erreur lors de l\'acceptation de la demande d\'ami :', error);
        sendResponse(res, 500, false, 'Échec de l\'acceptation de la demande d\'ami.', { error: error.message });
    }
});

app.post('/declineFriendRequest', async (req, res) => {
    const { userId, friendId } = req.body;
    if (!userId || !friendId) return sendResponse(res, 400, false, 'L\'ID utilisateur et l\'ID ami sont requis.');
    try {
        const updates = {};
        updates[`users/${userId}/friendRequestsReceived/${friendId}`] = null;
        updates[`users/${friendId}/friendRequestsSent/${userId}`] = null;
        await db.ref().update(updates);
        sendResponse(res, 200, true, 'Demande d\'ami refusée avec succès !');
    } catch (error) {
        console.error('Erreur lors du refus de la demande d\'ami :', error);
        sendResponse(res, 500, false, 'Échec du refus de la demande d\'ami.', { error: error.message });
    }
});

app.get('/getFriendsList/:userId', async (req, res) => {
    const userId = req.params.userId;
    if (!userId) return sendResponse(res, 400, false, 'L\'ID utilisateur est requis.');
    try {
        const snapshot = await db.ref(`users/${userId}/friends`).once('value');
        if (!snapshot.exists()) {
            return sendResponse(res, 200, true, 'Aucun ami pour le moment.', []);
        }
        const friendIds = Object.keys(snapshot.val());
        const friendsWithDetailsPromises = friendIds.map(async (id) => {
            const userSnapshot = await db.ref(`users/${id}/pseudo`).once('value');
            if (userSnapshot.exists()) {
                return { id: id, pseudo: userSnapshot.val() };
            }
            return null;
        });
        const friendsWithDetails = (await Promise.all(friendsWithDetailsPromises)).filter(Boolean);
        sendResponse(res, 200, true, 'Liste d\'amis récupérée.', friendsWithDetails);
    } catch (error) {
        console.error('Erreur lors de la récupération de la liste d\'amis :', error);
        sendResponse(res, 500, false, 'Échec de la récupération de la liste d\'amis.', { error: error.message });
    }
});

app.get('/getAllUsers', async (req, res) => {
    try {
        const snapshot = await db.ref('users').once('value');
        if (!snapshot.exists()) {
            return sendResponse(res, 200, true, 'Aucun utilisateur trouvé.', []);
        }
        const allUsersData = snapshot.val();
        const allUsers = Object.entries(allUsersData).map(([id, user]) => ({
            id: id,
            pseudo: user.pseudo || 'Pseudo inconnu'
        }));
        sendResponse(res, 200, true, 'Tous les utilisateurs récupérés.', allUsers);
    } catch (error) {
        console.error('Erreur lors de la récupération de tous les utilisateurs :', error);
        sendResponse(res, 500, false, 'Échec de la récupération de tous les utilisateurs.', { error: error.message });
    }
});

// --- ENDPOINTS POUR LES DONNÉES DE JEU ---

app.get("/api/leaderboard", async (req, res) => {
    console.log("--> Requête GET sur /api/leaderboard");
    try {
        const snapshot = await db.ref('users').orderByChild('gameData/mainScore').once('value');
        if (!snapshot.exists()) {
            return sendResponse(res, 200, true, 'Aucun utilisateur avec un score.', []);
        }
        const leaderboard = [];
        snapshot.forEach(childSnapshot => {
            const userData = childSnapshot.val();
            if (userData.gameData) {
                leaderboard.push({
                    userId: childSnapshot.key,
                    username: userData.pseudo,
                    profile: userData.profile,
                    gameData: userData.gameData
                });
            }
        });
        sendResponse(res, 200, true, 'Classement récupéré avec succès.', leaderboard.reverse());
    } catch (error) {
        console.error('Erreur lors de la récupération du classement :', error);
        sendResponse(res, 500, false, 'Échec de la récupération du classement.', { error: error.message });
    }
});

app.get("/api/users/:userId", async (req, res) => {
    const { userId } = req.params;
    console.log(`--> Requête GET sur /api/users/${userId}`);
    try {
        const snapshot = await db.ref(`users/${userId}`).once('value');
        if (snapshot.exists()) {
            sendResponse(res, 200, true, 'Utilisateur récupéré avec succès.', snapshot.val());
        } else {
            sendResponse(res, 404, false, 'Utilisateur non trouvé.');
        }
    } catch (error) {
        console.error('Erreur lors de la récupération de l\'utilisateur :', error);
        sendResponse(res, 500, false, 'Erreur serveur lors de la récupération de l\'utilisateur.', { error: error.message });
    }
});

app.get("/api/users/:userId/gameData", async (req, res) => {
    const { userId } = req.params;
    console.log(`--> Requête GET sur /api/users/${userId}/gameData`);
    try {
        const snapshot = await db.ref(`users/${userId}/gameData`).once('value');
        if (snapshot.exists()) {
            sendResponse(res, 200, true, 'Données de jeu récupérées avec succès.', snapshot.val());
        } else {
            sendResponse(res, 200, true, 'Aucune donnée de jeu trouvée.', {});
        }
    } catch (error) {
        console.error('Erreur lors de la récupération des données de jeu :', error);
        sendResponse(res, 500, false, 'Erreur serveur lors de la récupération des données de jeu.', { error: error.message });
    }
});

app.get("/api/users/:userId/gameData/:fieldName", async (req, res) => {
    const { userId, fieldName } = req.params;
    console.log(`--> Requête GET sur /api/users/${userId}/gameData/${fieldName}`);
    try {
        const snapshot = await db.ref(`users/${userId}/gameData/${fieldName}`).once('value');
        if (snapshot.exists()) {
            sendResponse(res, 200, true, 'Champ de donnée récupéré avec succès.', snapshot.val());
        } else {
            sendResponse(res, 404, false, `Champ de donnée '${fieldName}' non trouvé pour l'utilisateur '${userId}'.`);
        }
    } catch (error) {
        console.error('Erreur lors de la récupération du champ de donnée :', error);
        sendResponse(res, 500, false, 'Erreur serveur lors de la récupération du champ de donnée.', { error: error.message });
    }
});

app.post("/api/users/:userId/gameData", async (req, res) => {
    const { userId } = req.params;
    const { field, value } = req.body;
    console.log(`--> Requête POST sur /api/users/${userId}/gameData pour ${field}: ${value}`);

    if (!field || typeof value === "undefined") {
        return sendResponse(res, 400, false, "Champ ou valeur manquante dans la requête.");
    }
    
    try {
        const userRef = db.ref(`users/${userId}`);
        const userSnapshot = await userRef.once('value');
        if (!userSnapshot.exists()) {
            return sendResponse(res, 404, false, "Utilisateur non trouvé.");
        }

        const updates = {};
        updates[`gameData/${field}`] = value;
        await userRef.update(updates);
        sendResponse(res, 200, true, `Donnée de jeu '${field}' de l'utilisateur '${userId}' mise à jour à '${value}'.`);
    } catch (error) {
        console.error('Erreur lors de la mise à jour des données de jeu :', error);
        sendResponse(res, 500, false, "Erreur serveur lors de la mise à jour des données de jeu.", { error: error.message });
    }
});

app.post("/api/users/:userId/rename-game-field", async (req, res) => {
    const { userId } = req.params;
    const { oldField, newField } = req.body;
    console.log(`--> Requête POST sur /api/users/${userId}/rename-game-field pour ${oldField} -> ${newField}`);

    if (!oldField || !newField) {
        return sendResponse(res, 400, false, "Ancien ou nouveau nom de champ manquant.");
    }

    try {
        const userRef = db.ref(`users/${userId}`);
        const userSnapshot = await userRef.once('value');
        if (!userSnapshot.exists()) {
            return sendResponse(res, 404, false, "Utilisateur non trouvé.");
        }
        
        const gameDataSnapshot = await userRef.child('gameData').once('value');
        const gameData = gameDataSnapshot.val();

        if (!gameData || !gameData.hasOwnProperty(oldField)) {
            return sendResponse(res, 404, false, `Ancien champ de donnée '${oldField}' non trouvé pour l'utilisateur '${userId}'.`);
        }

        const updates = {};
        updates[`gameData/${newField}`] = gameData[oldField];
        updates[`gameData/${oldField}`] = null;
        await userRef.update(updates);

        sendResponse(res, 200, true, `Champ de donnée '${oldField}' de l'utilisateur '${userId}' renommé en '${newField}'.`);
    } catch (error) {
        console.error('Erreur lors du renommage du champ :', error);
        sendResponse(res, 500, false, "Erreur serveur lors du renommage du champ.", { error: error.message });
    }
});

// 7. Gestionnaire d'erreur global pour Express
app.use((err, req, res, next) => {
    console.error(err.stack);
    sendResponse(res, 500, false, 'Une erreur interne du serveur est survenue.', { error: err.message || 'Erreur inconnue du serveur.' });
});

// 8. Démarrage du serveur
app.listen(PORT, () => {
    console.log(`🚀 Serveur API unifié démarré sur http://localhost:${PORT}`);
});
