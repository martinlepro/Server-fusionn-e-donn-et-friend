
// server.js (Code fusionné pour gérer les amis et les profils de jeu avec Firebase)

// 1. Import des modules nécessaires
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid'; // Pour la création d'IDs uniques

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

// --- NOUVEAUX ENDPOINTS POUR LES PROFILS DE JEU ---

// Endpoint pour créer un nouveau profil de jeu lié à un utilisateur
app.post("/api/game/profiles", async (req, res) => {
    const { pseudo, ownerUid } = req.body;
    if (!pseudo || !ownerUid) {
        return sendResponse(res, 400, false, "Le pseudo et l'ID de l'utilisateur sont requis.");
    }
    
    try {
        const newProfileId = uuidv4();
        const newProfileRef = db.ref(`gameProfiles/${newProfileId}`);
        const userRef = db.ref(`users/${ownerUid}`);

        // Vérifier si l'utilisateur existe
        const userSnapshot = await userRef.once('value');
        if (!userSnapshot.exists()) {
            return sendResponse(res, 404, false, 'Utilisateur propriétaire non trouvé.');
        }

        // Création du profil de jeu avec le lien vers l'utilisateur
        await newProfileRef.set({
            profileId: newProfileId,
            pseudo: pseudo,
            ownerUid: ownerUid,
            mainScore: 0,
            level: 0,
            createdAt: admin.database.ServerValue.TIMESTAMP
        });

        // Ajouter le nouvel ID de profil au noeud de l'utilisateur
        await userRef.child(`gameProfileIds/${newProfileId}`).set(true);

        console.log(`Nouveau profil de jeu créé: ${pseudo} (${newProfileId}) pour l'utilisateur ${ownerUid}`);
        sendResponse(res, 201, true, 'Nouveau profil de jeu créé avec succès !', { profileId: newProfileId, pseudo: pseudo });

    } catch (error) {
        console.error('Erreur lors de la création du profil de jeu :', error);
        sendResponse(res, 500, false, 'Échec de la création du profil de jeu.', { error: error.message });
    }
});

// Endpoint pour mettre à jour les données d'un profil de jeu
app.post("/api/game/profiles/:profileId/gameData", async (req, res) => {
    const { profileId } = req.params;
    const { field, value } = req.body;

    if (!field || typeof value === "undefined") {
        return sendResponse(res, 400, false, "Champ ou valeur manquante dans la requête.");
    }
    
    try {
        const profileRef = db.ref(`gameProfiles/${profileId}`);
        const profileSnapshot = await profileRef.once('value');
        if (!profileSnapshot.exists()) {
            return sendResponse(res, 404, false, "Profil de jeu non trouvé.");
        }

        const updates = {};
        updates[field] = value;
        await profileRef.update(updates);
        sendResponse(res, 200, true, `Donnée de jeu '${field}' du profil '${profileId}' mise à jour.`);
    } catch (error) {
        console.error('Erreur lors de la mise à jour des données de jeu :', error);
        sendResponse(res, 500, false, "Erreur serveur lors de la mise à jour des données de jeu.", { error: error.message });
    }
});


// Endpoint pour obtenir les données d'un profil de jeu
app.get("/api/game/profiles/:profileId", async (req, res) => {
    const { profileId } = req.params;
    try {
        const snapshot = await db.ref(`gameProfiles/${profileId}`).once('value');
        if (snapshot.exists()) {
            sendResponse(res, 200, true, 'Profil de jeu récupéré.', snapshot.val());
        } else {
            sendResponse(res, 404, false, 'Profil de jeu non trouvé.');
        }
    } catch (error) {
        console.error('Erreur lors de la récupération du profil de jeu :', error);
        sendResponse(res, 500, false, 'Erreur serveur lors de la récupération du profil de jeu.', { error: error.message });
    }
});

// Endpoint pour obtenir les profils de jeu d'un utilisateur
app.get("/api/game/profiles-by-user/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
        const snapshot = await db.ref('gameProfiles').orderByChild('ownerUid').equalTo(userId).once('value');
        if (!snapshot.exists()) {
            return sendResponse(res, 200, true, 'Aucun profil de jeu trouvé pour cet utilisateur.', []);
        }
        const profiles = Object.values(snapshot.val());
        sendResponse(res, 200, true, 'Profils de jeu récupérés.', profiles);
    } catch (error) {
        console.error('Erreur lors de la récupération des profils de jeu par utilisateur :', error);
        sendResponse(res, 500, false, 'Échec de la récupération des profils de jeu.', { error: error.message });
    }
});

// Endpoint pour le classement général
app.get("/api/leaderboard", async (req, res) => {
    try {
        const snapshot = await db.ref('gameProfiles').orderByChild('mainScore').limitToLast(100).once('value');
        if (!snapshot.exists()) {
            return sendResponse(res, 200, true, 'Aucun profil de jeu avec un score.', []);
        }
        const leaderboard = [];
        snapshot.forEach(childSnapshot => {
            leaderboard.push(childSnapshot.val());
        });
        sendResponse(res, 200, true, 'Classement récupéré avec succès.', leaderboard.reverse());
    } catch (error) {
        console.error('Erreur lors de la récupération du classement :', error);
        sendResponse(res, 500, false, 'Échec de la récupération du classement.', { error: error.message });
    }
});

// --- ENDPOINTS DU SYSTÈME D'AMIS (PAS DE CHANGEMENTS ICI) ---

// Ces endpoints gèrent l'utilisateur principal, pas les profils de jeu
// Note: Il faudra créer un endpoint 'createUser' si tu n'as pas de système d'authentification dans ton jeu.
// Pour l'instant, ton extension FriendsExtension.js gère la création/connexion de l'utilisateur.

// Exemple : endpoint findOrCreateUser (à adapter selon tes besoins d'authentification)
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
            const newUserId = uuidv4();
            const newUserRef = db.ref('users').child(newUserId);
            await newUserRef.set({
                userId: newUserId,
                pseudo: pseudo,
                profile: { bio: "", avatarUrl: "", customStatus: "" },
                gameProfileIds: {}, // Liste pour les IDs de profils de jeu
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

// ... (Ajouter ici les autres endpoints du système d'amis comme getFriendsList, sendFriendRequest, etc.) ...
// Comme ils interagissent avec le noeud 'users', ils ne nécessitent pas de changements majeurs.

// --- GESTIONNAIRE D'ERREUR ET DÉMARRAGE DU SERVEUR ---

// Gestionnaire d'erreur global
app.use((err, req, res, next) => {
    console.error(err.stack);
    sendResponse(res, 500, false, 'Une erreur interne du serveur est survenue.', { error: err.message || 'Erreur inconnue du serveur.' });
});

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`🚀 Serveur API unifié démarré sur http://localhost:${PORT}`);
});

