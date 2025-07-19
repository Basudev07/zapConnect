// --- Firebase Imports ---
// These imports pull in the necessary functions from the Firebase SDK.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot, 
    collection, addDoc, query, where, getDocs, deleteDoc, 
    serverTimestamp, orderBy
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Firebase Configuration ---
// IMPORTANT: Replace this with your own Firebase project configuration!
const firebaseConfig = {
    apiKey: "AIzaSyALFRENaFhD6EpiNt_d9o1p4AIrzMVxoOI",
    authDomain: "anonymous-chat-61a9b.firebaseapp.com",
    projectId: "anonymous-chat-61a9b",
    storageBucket: "anonymous-chat-61a9b.appspot.com",
    messagingSenderId: "38930594500",
    appId: "1:38930594500:web:d6710d4a6ceec05ae7e791"
};

// --- Main App Logic ---
// We wrap the entire script in a DOMContentLoaded listener to ensure the HTML is loaded before the script runs.
document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Elements ---
    const userIdEl = document.getElementById('user-id');
    const chatMessagesEl = document.getElementById('chat-messages');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const newStrangerButton = document.getElementById('new-stranger-button');
    const statusEl = document.getElementById('status');
    const initialStateEl = document.getElementById('initial-state');
    const typingIndicatorEl = document.getElementById('typing-indicator');
    const themeToggler = document.getElementById('dark-mode-toggler');
    const themeToggleKnob = document.getElementById('dark-mode-knob');
    const html = document.documentElement;

    // --- Global State Variables ---
    let db, auth;
    let userId;
    let strangerId = null;
    let currentChatRoomId = null;
    let unsubscribeChat = null;
    let unsubscribeUserStatus = null;
    let typingTimeout = null;
    let isSearching = false; // NEW: State to track if we are currently searching

    // --- Initialization ---
    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        signInAnonymously(auth)
            .then((userCredential) => {
                userId = userCredential.user.uid;
                if (userIdEl) {
                    userIdEl.textContent = userId.substring(0, 8);
                }
                console.log("User authenticated with ID:", userId);
            })
            .catch((error) => {
                console.error("Anonymous sign-in failed:", error);
                if (statusEl) {
                    statusEl.textContent = "Error: Could not authenticate.";
                }
            });
    } catch (error) {
        console.error("Firebase initialization failed:", error);
        if (statusEl) {
            statusEl.textContent = "Error: Could not connect to the service.";
        }
    }

    // --- UI Helper Functions ---

    /**
     * Adds a message bubble to the chat window.
     */
    function addMessageToChat(msgData, msgId) {
        if (!initialStateEl || !chatMessagesEl) return;
        initialStateEl.style.display = 'none';
        const type = msgData.senderId === userId ? 'sent' : 'received';

        const container = document.createElement('div');
        container.classList.add('message-container', type);
        container.dataset.messageId = msgId;

        const bubble = document.createElement('div');
        bubble.classList.add('message-bubble', type);

        const textSpan = document.createElement('span');
        textSpan.classList.add('message-text');
        textSpan.textContent = msgData.text;

        bubble.appendChild(textSpan);

        if (type === 'sent') {
            const ticksSpan = document.createElement('span');
            ticksSpan.classList.add('ticks');
            const tickImg = document.createElement('img');
            tickImg.classList.add('tick-icon');
            tickImg.src = msgData.status === 'read' ? 'public/doubletick.png' : 'public/tick.png';
            ticksSpan.appendChild(tickImg);
            bubble.appendChild(ticksSpan);
        }
        
        container.appendChild(bubble);
        chatMessagesEl.appendChild(container);
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }

    /**
     * Updates the status ticks on an existing message.
     */
    function updateMessageStatus(msgId, status) {
        const messageContainer = document.querySelector(`[data-message-id="${msgId}"]`);
        if (messageContainer) {
            const tickImg = messageContainer.querySelector('.tick-icon');
            if (tickImg && status === 'read') {
                tickImg.src = 'public/doubletick.png';
            }
        }
    }

    /**
     * Resets the chat UI to its initial state.
     */
    function resetChatUI() {
        if (!chatMessagesEl || !initialStateEl || !messageInput || !sendButton || !statusEl || !typingIndicatorEl) return;
        chatMessagesEl.innerHTML = '';
        initialStateEl.style.display = 'flex';
        messageInput.disabled = true;
        sendButton.disabled = true;
        messageInput.value = '';
        statusEl.textContent = '';
        typingIndicatorEl.style.display = 'none';
    }

    /**
     * Resets the main action button to its default state.
     */
    function resetButtonToDefault() {
        if (!newStrangerButton) return;
        isSearching = false; // UPDATED: Reset searching state
        newStrangerButton.disabled = false;
        newStrangerButton.innerHTML = 'Find New Stranger';
        newStrangerButton.classList.remove('bg-red-500', 'hover:bg-red-600');
        newStrangerButton.classList.add('bg-green-500', 'hover:bg-green-600');
    }

    /**
     * Enables the chat input and send button.
     */
    function enableChat() {
        if (!messageInput || !sendButton || !statusEl) return;
        messageInput.disabled = false;
        sendButton.disabled = false;
        resetButtonToDefault();
        statusEl.textContent = "Connected with a stranger!";
    }

    /**
     * Disables the chat and shows a system message.
     */
    function disableChat(message) {
        resetChatUI();
        const systemMessage = document.createElement('div');
        systemMessage.classList.add('message-system');
        systemMessage.textContent = message;
        if (chatMessagesEl) {
            chatMessagesEl.appendChild(systemMessage);
        }
        
        resetButtonToDefault();
        currentChatRoomId = null;
        strangerId = null;
        if (unsubscribeChat) unsubscribeChat();
    }

    // --- Core Chat Logic ---

    /**
     * Finds a stranger from the waiting pool or joins the pool.
     */
    async function findNewStranger() {
        if (currentChatRoomId) {
            await leaveChatRoom();
        }

        resetChatUI();
        statusEl.textContent = "Searching for a stranger...";
        
        // UPDATED: Set button to loading state
        isSearching = true; // UPDATED: Set searching state
        newStrangerButton.innerHTML = `
            <div role="status" class="flex items-center justify-center">
                <svg aria-hidden="true" class="inline w-6 h-6 mr-3 text-white animate-spin fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
                    <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
                </svg>
                <span>Cancel Search</span>
            </div>
        `;
        newStrangerButton.classList.add('bg-red-500', 'hover:bg-red-600');
        newStrangerButton.classList.remove('bg-green-500', 'hover:bg-green-600');

        try {
            const waitingPoolRef = collection(db, "waitingPool");
            const q = query(waitingPoolRef, where("status", "==", "waiting"));
            const querySnapshot = await getDocs(q);

            let strangerDoc = querySnapshot.docs.find(doc => doc.id !== userId);

            if (strangerDoc) {
                strangerId = strangerDoc.id;
                
                const chatRoomRef = collection(db, "chatRooms");
                const newChatRoom = await addDoc(chatRoomRef, {
                    users: [userId, strangerId],
                    createdAt: serverTimestamp(),
                    status: 'active'
                });
                currentChatRoomId = newChatRoom.id;

                await setDoc(doc(db, `waitingPool/${userId}`), { status: 'chatting', chatRoomId: currentChatRoomId });
                await setDoc(doc(db, `waitingPool/${strangerId}`), { status: 'chatting', chatRoomId: currentChatRoomId });
                
                startChatSession(currentChatRoomId);

            } else {
                await setDoc(doc(db, `waitingPool/${userId}`), {
                    status: 'waiting',
                    timestamp: serverTimestamp()
                });

                unsubscribeUserStatus = onSnapshot(doc(db, `waitingPool/${userId}`), (docSnap) => {
                    const data = docSnap.data();
                    if (data && data.status === 'chatting' && data.chatRoomId) {
                        currentChatRoomId = data.chatRoomId;
                        startChatSession(currentChatRoomId);
                        if (unsubscribeUserStatus) unsubscribeUserStatus();
                    }
                });
            }
        } catch (error) {
            console.error("Error finding stranger:", error);
            statusEl.textContent = "Error during search. Please try again.";
            resetButtonToDefault();
        }
    }

    /**
     * Starts listening to a chat room for new messages and status changes.
     */
    function startChatSession(chatRoomId) {
        enableChat();
        const chatRoomRef = doc(db, `chatRooms/${chatRoomId}`);
        
        getDoc(chatRoomRef).then(docSnap => {
            if (docSnap.exists()) {
                const users = docSnap.data().users;
                strangerId = users.find(id => id !== userId);
            }
        });

        const messagesRef = collection(db, `chatRooms/${chatRoomId}/messages`);
        const q = query(messagesRef, orderBy("timestamp", "asc"));

        unsubscribeChat = onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                const msgData = change.doc.data();
                const msgId = change.doc.id;

                if (change.type === "added") {
                    addMessageToChat(msgData, msgId);
                    if (msgData.senderId !== userId && msgData.status !== 'read') {
                        updateDoc(doc(db, `chatRooms/${chatRoomId}/messages/${msgId}`), { status: 'read' });
                    }
                }
                if (change.type === "modified") {
                    if (msgData.senderId === userId) {
                        updateMessageStatus(msgId, msgData.status);
                    }
                }
            });
        });

        onSnapshot(chatRoomRef, (docSnap) => {
            const data = docSnap.data();
            if (!data) return;

            if (data.status === 'disconnected') {
                disableChat("Stranger has disconnected.");
                return;
            }
            
            if (typingIndicatorEl) {
                if (strangerId && data[`${strangerId}_typing`]) {
                    typingIndicatorEl.style.display = 'flex';
                } else {
                    typingIndicatorEl.style.display = 'none';
                }
            }
        });
    }

    /**
     * Leaves the current chat room and cleans up database entries.
     */
    async function leaveChatRoom() {
        if (unsubscribeUserStatus) unsubscribeUserStatus();
        if (unsubscribeChat) unsubscribeChat();

        if (currentChatRoomId) {
            const chatRoomRef = doc(db, `chatRooms/${currentChatRoomId}`);
            await updateDoc(chatRoomRef, { status: 'disconnected' }).catch(e => console.log("Chat room may already be deleted."));
        }
        
        if (userId) {
            await deleteDoc(doc(db, `waitingPool/${userId}`)).catch(e => console.log("User status already cleaned up."));
        }

        currentChatRoomId = null;
        disableChat("You have left the chat.");
    }

    /**
     * Sends a message to the current chat room.
     */
    async function sendMessage(e) {
        e.preventDefault();
        const text = messageInput.value.trim();
        if (text && currentChatRoomId) {
            const messagesRef = collection(db, `chatRooms/${currentChatRoomId}/messages`);
            await addDoc(messagesRef, {
                text: text,
                senderId: userId,
                timestamp: serverTimestamp(),
                status: 'sent'
            });
            messageInput.value = '';
            updateTypingStatus(false);
            clearTimeout(typingTimeout);
            typingTimeout = null;
        }
    }

    /**
     * Updates the user's typing status in Firestore.
     */
    async function updateTypingStatus(isTyping) {
        if (!currentChatRoomId || !userId) return;
        const chatRoomRef = doc(db, `chatRooms/${currentChatRoomId}`);
        const typingUpdate = {};
        typingUpdate[`${userId}_typing`] = isTyping;
        await updateDoc(chatRoomRef, typingUpdate);
    }


    // --- Event Listeners ---

    newStrangerButton.addEventListener('click', () => {
        // UPDATED: Logic now checks the 'isSearching' flag instead of the disabled property.
        if (isSearching) {
            leaveChatRoom();
            statusEl.textContent = "Search canceled.";
        } else {
            findNewStranger();
        }
    });

    messageForm.addEventListener('submit', sendMessage);

    messageInput.addEventListener('input', () => {
        if (typingTimeout) {
            clearTimeout(typingTimeout);
        } else {
            updateTypingStatus(true);
        }
        
        typingTimeout = setTimeout(() => {
            updateTypingStatus(false);
            typingTimeout = null;
        }, 2000);
    });

    window.addEventListener('beforeunload', () => {
        if (currentChatRoomId) {
            leaveChatRoom();
        }
    });

    // --- Dark Mode Toggle Logic ---
    function applyTheme(theme) {
        if (theme === 'dark') {
            html.classList.add('dark');
            themeToggleKnob.classList.add('translate-x-7');
        } else {
            html.classList.remove('dark');
            themeToggleKnob.classList.remove('translate-x-7');
        }
    }

    const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(savedTheme);

    themeToggler.addEventListener('click', () => {
        const isDarkMode = html.classList.toggle('dark');
        themeToggleKnob.classList.toggle('translate-x-7');
        localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    });

});
