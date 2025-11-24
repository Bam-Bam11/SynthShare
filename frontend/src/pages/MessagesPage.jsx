// src/pages/MessagesPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import API from '../api';

const MessagesPage = () => {
  const { username } = useParams();
  const navigate = useNavigate();

  const [currentUser, setCurrentUser] = useState(null);
  const [otherUser, setOtherUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Following search state
  const [following, setFollowing] = useState([]);
  const [followSearch, setFollowSearch] = useState('');

  // Load current user
  useEffect(() => {
    const loadMe = async () => {
      try {
        const res = await API.get('/users/me/');
        setCurrentUser(res.data);
      } catch (err) {
        console.error('Failed to load current user', err);
      }
    };
    loadMe();
  }, []);

  // Load users you currently follow (for search)
  useEffect(() => {
    const loadFollowing = async () => {
      if (!currentUser || !currentUser.username) return;

      try {
        const res = await API.get(
          `/users/username/${currentUser.username}/following/`
        );

        // Handle either plain list or paginated {results: [...]}
        const data = res.data;
        let list = [];
        if (Array.isArray(data?.results)) {
          list = data.results;
        } else if (Array.isArray(data)) {
          list = data;
        } else if (data?.users && Array.isArray(data.users)) {
          list = data.users;
        } else {
          list = [];
        }

        setFollowing(list);
      } catch (err) {
        console.error('Failed to load following list', err);
        setFollowing([]);
      }
    };

    if (currentUser) {
      loadFollowing();
    }
  }, [currentUser]);

  // When username in URL changes, resolve that user
  useEffect(() => {
    if (!username) {
      setOtherUser(null);
      setMessages([]);
      return;
    }

    const loadOtherUser = async () => {
      setError('');
      try {
        const res = await API.get(`/users/username/${username}/`);
        setOtherUser(res.data);
      } catch (err) {
        console.error('Could not load user', err);
        setError('Could not find that user.');
        setOtherUser(null);
        setMessages([]);
      }
    };

    loadOtherUser();
  }, [username]);

  // Load conversation when we have an otherUser
  const loadConversation = async () => {
    if (!otherUser) return;
    setLoading(true);
    setError('');
    try {
      const res = await API.get('/messages/', {
        params: { other_user: otherUser.id },
      });
      
      // FIX: Handle paginated response
      const responseData = res.data;
      let messagesArray = [];
      
      if (Array.isArray(responseData)) {
        messagesArray = responseData;
      } else if (responseData && Array.isArray(responseData.results)) {
        // DRF paginated response
        messagesArray = responseData.results;
      } else if (responseData && Array.isArray(responseData.data)) {
        // Alternative pagination format
        messagesArray = responseData.data;
      }
      
      setMessages(messagesArray);

      // Mark all messages from otherUser as read
      if (messagesArray.length > 0) {
        await API.post('/messages/mark_conversation_read/', {
          other_user: otherUser.id,
        });
      }
    } catch (err) {
      console.error('Failed to load messages', err);
      setError('Could not load messages.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherUser]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!content.trim() || !otherUser) return;
    setSending(true);
    setError('');

    try {
      const res = await API.post('/messages/', {
        recipient: otherUser.id,
        content: content.trim(),
      });

      setContent('');
      // Reload the conversation to get proper ordering
      await loadConversation();
    } catch (err) {
      console.error('Failed to send message', err);
      setError('Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  // Handle selection from search
  const handleSelectUserFromSearch = async (user) => {
    setFollowSearch(''); // Clear search
    setOtherUser(user); // Set the other user immediately
    navigate(`/messages/${user.username}`); // Update URL
  };

  // Handle selection from existing conversations
  const handleSelectUserFromConversation = (user) => {
    setOtherUser(user);
    navigate(`/messages/${user.username}`);
  };

  // Simple list of all conversations (people you have messaged with)
  const [conversations, setConversations] = useState([]);

  useEffect(() => {
    const loadConversations = async () => {
      try {
        const res = await API.get('/messages/');
        const responseData = res.data;
        
        // FIX: Handle paginated response for conversations too
        let rawMessages = [];
        if (Array.isArray(responseData)) {
          rawMessages = responseData;
        } else if (responseData && Array.isArray(responseData.results)) {
          rawMessages = responseData.results;
        } else if (responseData && Array.isArray(responseData.data)) {
          rawMessages = responseData.data;
        }

        // Build a set of counterpart users (other than me) from messages
        const map = new Map();

        rawMessages.forEach((m) => {
          const isSender = currentUser && m.sender === currentUser.id;
          const otherId = isSender ? m.recipient : m.sender;
          const otherName = isSender ? m.recipient_username : m.sender_username;
          if (otherId && !map.has(otherId)) {
            map.set(otherId, { id: otherId, username: otherName });
          }
        });

        setConversations(Array.from(map.values()));
      } catch (err) {
        console.error('Failed to load conversation list', err);
      }
    };

    if (currentUser) {
      loadConversations();
    }
  }, [currentUser, messages]); // Added messages dependency to refresh when new messages are sent

  // Filter following list by search term
  const trimmedSearch = followSearch.trim().toLowerCase();
  const filteredFollowing = trimmedSearch
    ? following.filter((u) =>
        (u.username || '')
          .toLowerCase()
          .includes(trimmedSearch)
      )
    : [];

  return (
    <div className="max-w-5xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Direct Messages</h1>

      <div className="grid grid-cols-12 gap-4">
        {/* Sidebar: search + conversation list */}
        <aside className="col-span-4 border rounded p-3">
          {/* Search among people you follow */}
          <div className="mb-4">
            <h2 className="font-semibold mb-1 text-sm">
              Start a conversation
            </h2>
            <p className="text-xs text-gray-500 mb-2">
              Search only among users you follow.
            </p>
            <input
              type="text"
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="Search followed users..."
              value={followSearch}
              onChange={(e) => setFollowSearch(e.target.value)}
            />
            {trimmedSearch && (
              <ul className="mt-2 max-h-40 overflow-y-auto text-sm space-y-1">
                {filteredFollowing.length === 0 ? (
                  <li className="text-gray-500">
                    No matches among people you follow.
                  </li>
                ) : (
                  filteredFollowing.map((u) => (
                    <li key={u.id}>
                      <button
                        className="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                        onClick={() => handleSelectUserFromSearch(u)}
                      >
                        {u.username}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          <h2 className="font-semibold mb-2 text-sm">Conversations</h2>
          {conversations.length === 0 && (
            <div className="text-sm text-gray-500">
              No conversations yet. Search above to start a chat with someone you follow.
            </div>
          )}
          <ul className="space-y-1">
            {conversations.map((conv) => (
              <li key={conv.id}>
                <button
                  className={`w-full text-left px-2 py-1 rounded ${
                    otherUser && otherUser.id === conv.id
                      ? 'bg-blue-600 text-white'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => handleSelectUserFromConversation(conv)}
                >
                  {conv.username}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Main: conversation */}
        <main className="col-span-8 border rounded flex flex-col min-h-[500px]">
          <div className="border-b px-3 py-2 flex items-center justify-between">
            <div>
              {otherUser ? (
                <>
                  <div className="font-semibold">{otherUser.username}</div>
                  <div className="text-xs text-gray-500">Conversation</div>
                </>
              ) : (
                <div className="text-sm text-gray-500">
                  Select a conversation from the left, or search for someone you
                  follow to start a new chat.
                </div>
              )}
            </div>
            {otherUser && (
              <button
                className="text-xs px-2 py-1 border rounded"
                onClick={loadConversation}
                disabled={loading}
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            )}
          </div>

          {/* Message history */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-[300px]">
            {error && (
              <div className="text-red-600 text-sm mb-2">{error}</div>
            )}

            {otherUser && messages.length === 0 && !loading && (
              <div className="text-sm text-gray-500 text-center mt-8">
                No messages yet. Say hello!
              </div>
            )}

            {otherUser && loading && (
              <div className="text-sm text-gray-500 text-center mt-8">
                Loading messages...
              </div>
            )}

            {Array.isArray(messages) && messages.map((m) => {
              const isMine = currentUser && m.sender === currentUser.id;
              return (
                <div
                  key={m.id}
                  className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs px-3 py-2 rounded-lg text-sm ${
                      isMine
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 dark:text-gray-100'
                    }`}
                  >
                    <div>{m.content}</div>
                    <div className="mt-1 text-[0.65rem] opacity-70">
                      {new Date(m.created_at).toLocaleString()}
                      {!isMine && !m.is_read && ' • unread'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Composer */}
          {otherUser && (
            <form
              onSubmit={handleSend}
              className="border-t px-3 py-2 flex gap-2"
            >
              <input
                type="text"
                className="flex-1 border rounded px-2 py-1"
                placeholder="Type a message..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={sending}
              />
              <button
                type="submit"
                disabled={sending || !content.trim()}
                className="btn btn-primary disabled:opacity-50"
              >
                {sending ? 'Sending...' : 'Send'}
              </button>
            </form>
          )}
        </main>
      </div>
    </div>
  );
};

export default MessagesPage;