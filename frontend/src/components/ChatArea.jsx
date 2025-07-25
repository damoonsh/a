import { useState, useEffect } from 'react'
import { useSession } from '../context/SessionContext'
import MessageInput from './chat/MessageInput'
import FileUpload from './chat/FileUpload'
import ChatHeader from './chat/ChatHeader'
import ChatMessages from './chat/ChatMessages'
import apiService from '../services/apiService'
import mockApiService from '../services/mockApiService'

function ChatArea() {
  const { currentSession, addMessage, updateSessionModel, convertTemporarySession } = useSession()
  const [isLoading, setIsLoading] = useState(false)
  const [availableModels, setAvailableModels] = useState([
    { id: "tinyllama:latest", name: "TinyLlama" },
    { id: "qwen3:0.6b", name: "Qwen 0.6B" },
    { id: "smollm2:360m", name: "SmoLLM2 360M" },
  ])
  const [selectedModel, setSelectedModel] = useState(availableModels[0].id)
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [useContext, setUseContext] = useState(true)
  const [streamingMessage, setStreamingMessage] = useState("")
  const [apiMode, setApiMode] = useState(true) // Default to real API mode

  const [showFileUploadDialog, setShowFileUploadDialog] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editingMessageText, setEditingMessageText] = useState("")

  // Fetch available models on component mount
  useEffect(() => {
    mockApiService.getAvailableModels()
      .then(models => {
        setAvailableModels(models);
        setSelectedModel(models[0].id);
      })
      .catch(error => console.error("Failed to fetch models:", error));
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    // Use DOM API directly instead of useRef
    const messagesEnd = document.getElementById('messages-end')
    if (messagesEnd) {
      messagesEnd.scrollIntoView({ behavior: 'smooth' })
    }
  }, [currentSession?.messages, streamingMessage])

  // Store the initial model when the session changes
  useEffect(() => {
    if (currentSession) {
      // Just store the selected model locally, don't update the session
      setSelectedModel(currentSession.modelName || availableModels[0].id)
    }
  }, [currentSession])

  const handleSendMessage = async (message) => {
    if (!message.trim() || isLoading) return

    // Add user message to chat - no model name for user messages
    await addMessage(message, true, null)

    // Set loading state
    setIsLoading(true)
    setStreamingMessage("")

    if (apiMode) {
      // Use real API service
      try {
        // Generate a simulated response for now (in a real app, this would call an LLM)
        const simulatedResponse = `This is a response to: "${message}". In a real implementation, this would be generated by an LLM model (${selectedModel}).`

        // Handle thread creation if needed
        let threadId = currentSession.id
        if (currentSession.isTemporary) {
          // Create a new thread first
          const newThread = await apiService.createThread()
          threadId = newThread.thread_id

          // Convert temporary session to use backend-generated thread_id
          convertTemporarySession(currentSession.id, newThread)
        }

        // Create the message in the backend - backend generates message_id and edit_id
        await apiService.createMessage(
          threadId,
          message,
          simulatedResponse,
          selectedModel
        )

        // Use the thread_id to refresh the conversation
        const updatedConversation = await apiService.getConversation(threadId)
        const transformedConversation = apiService.transformConversation(updatedConversation)

        // Update the session with the new messages
        updateSessionModel(threadId, selectedModel, transformedConversation.messages)

        setIsLoading(false)
        setStreamingMessage("")
      } catch (error) {
        console.error("Error with real API:", error)
        addMessage("I'm sorry, I encountered an error processing your request.", false, selectedModel)
        setIsLoading(false)
        setStreamingMessage("")
      }
    } else {
      // Use our mock API service for streaming responses
      mockApiService.sendMessage(
        message,
        selectedModel,
        useContext && uploadedFiles.length > 0,
        // On chunk callback
        (chunk) => {
          setStreamingMessage(prev => prev + chunk);
        },
        // On complete callback
        (fullResponse) => {
          // Handle the response based on the current session format
          if (currentSession && currentSession.messages) {
            const lastMessageIndex = currentSession.messages.length - 1;
            const lastMessage = currentSession.messages[lastMessageIndex];

            // Check if we're using the edits format
            if (lastMessage && lastMessage.edits) {
              // Mock mode: Just update the UI directly (no persistence)
              const updatedMessage = {
                ...lastMessage,
                edits: [...lastMessage.edits, {
                  edit_id: `mock_edit_${lastMessage.edits.length + 1}`,
                  model_name: selectedModel,
                  timestamp: new Date().toISOString(),
                  question: message,
                  answer: fullResponse
                }]
              };

              const updatedMessages = [...currentSession.messages];
              updatedMessages[lastMessageIndex] = updatedMessage;
              updateSessionModel(currentSession.id, selectedModel, updatedMessages);
            }
            // If we're using the question-answer format
            else if (lastMessage && lastMessage.question) {
              // Update the last message with the answer
              const updatedMessage = {
                ...lastMessage,
                answer: fullResponse,
                model_name: selectedModel
              };

              // Replace the last message with the updated one
              const updatedMessages = [...currentSession.messages];
              updatedMessages[lastMessageIndex] = updatedMessage;

              // Update the session with the new messages
              updateSessionModel(currentSession.id, selectedModel, updatedMessages);
            } else {
              // Fall back to the old way if needed
              addMessage(fullResponse, false, selectedModel);
            }
          }

          setIsLoading(false);
          setStreamingMessage("");
        },
        // On error callback
        (error) => {
          console.error("Error in mock API:", error);
          addMessage("I'm sorry, I encountered an error processing your request.", false, selectedModel);
          setIsLoading(false);
          setStreamingMessage("");
        },
        // Thread ID for saving the conversation
        currentSession?.id
      );
    }
  }

  const handleFileUpload = async (file, onProgress) => {
    setIsProcessing(true)

    // Mock mode: Simulate file upload without actual processing
    try {
      // Simulate upload progress
      for (let progress = 0; progress <= 100; progress += 10) {
        onProgress(progress);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Create mock file object
      const mockFile = {
        id: `mock_file_${Date.now()}`,
        name: file.name,
        size: file.size,
        type: file.type,
        uploadedAt: new Date().toISOString()
      };

      setUploadedFiles(prev => [...prev, mockFile]);
      setIsProcessing(false);
      return mockFile;
    } catch (error) {
      setIsProcessing(false);
      throw error;
    }
  }

  const handleRemoveFile = (fileId) => {
    setUploadedFiles(prev => prev.filter(file => file.id !== fileId))
  }

  // No longer need handleSettingsChange as settings are managed globally

  // Handle editing a message
  const handleEditMessage = (messageId, questionText) => {
    setEditingMessageId(messageId)
    setEditingMessageText(questionText)
  }

  // Handle submitting an edited message
  const handleSubmitEdit = async (updatedMessage) => {
    if (!editingMessageId || !updatedMessage.trim()) return

    // Find the message being edited
    const messageToEdit = currentSession.messages.find(msg => msg.id === editingMessageId)
    if (!messageToEdit) return

    // Set loading state
    setIsLoading(true)

    try {
      if (apiMode) {
        // Use real API service
        if (messageToEdit.edits) {
          // Generate a new response for the edited question
          const simulatedResponse = `This is a response to the edited question: "${updatedMessage}". Generated by ${selectedModel}.`
          console.log(updatedMessage)
          // Create a new edit with the updated question and new answer
          // Use messageToEdit.id which came from backend
          await apiService.createMessageEdit(
            messageToEdit.id,
            updatedMessage,
            simulatedResponse,
            selectedModel
          )

          // Refresh the conversation to get the updated data
          // Use currentSession.id which is the thread_id from backend
          const updatedConversation = await apiService.getConversation(currentSession.id)
          const transformedConversation = apiService.transformConversation(updatedConversation)

          // Update the session with the new messages
          updateSessionModel(currentSession.id, selectedModel, transformedConversation.messages)
        }
      } else {
        // Use mock API service - just update UI directly
        if (messageToEdit.edits) {
          // Get the latest edit
          const latestEdit = messageToEdit.edits[messageToEdit.edits.length - 1];

          // Mock mode: Add new edit directly to UI state
          const newEdit = {
            edit_id: `mock_edit_${messageToEdit.edits.length + 1}`,
            model_name: selectedModel,
            timestamp: new Date().toISOString(),
            question: updatedMessage,
            answer: latestEdit.answer
          };

          const updatedMessages = [...currentSession.messages];
          const messageIndex = updatedMessages.findIndex(msg => msg.id === editingMessageId);

          if (messageIndex !== -1) {
            updatedMessages[messageIndex] = {
              ...updatedMessages[messageIndex],
              edits: [...updatedMessages[messageIndex].edits, newEdit]
            };
            updateSessionModel(currentSession.id, selectedModel, updatedMessages);
          }
        } else {
          // For legacy format, just update the message
          const updatedMessages = [...currentSession.messages];
          const messageIndex = updatedMessages.findIndex(msg => msg.id === editingMessageId);

          if (messageIndex !== -1) {
            updatedMessages[messageIndex] = {
              ...updatedMessages[messageIndex],
              question: updatedMessage
            };

            // Update the session with the new messages
            updateSessionModel(currentSession.id, selectedModel, updatedMessages);
          }
        }
      }

      // Clear editing state
      setEditingMessageId(null);
      setEditingMessageText("");
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to submit edit:', error)
      setIsLoading(false)
    }
  }

  // Cancel editing
  const handleCancelEdit = () => {
    setEditingMessageId(null)
    setEditingMessageText("")
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-gray-800 h-full">
      {/* Header with model selector and controls */}
      <ChatHeader
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        availableModels={availableModels}
        uploadedFiles={uploadedFiles}
        useContext={useContext}
        setUseContext={setUseContext}
        apiMode={apiMode}
        setApiMode={setApiMode}
      />

      {/* Chat messages area */}
      <ChatMessages
        currentSession={currentSession}
        streamingMessage={streamingMessage}
        isLoading={isLoading}
        selectedModel={selectedModel}
        handleEditMessage={handleEditMessage}
      />

      {/* Message input - added shrink-0 to prevent it from shrinking */}
      <div className="shrink-0">
        {editingMessageId ? (
          <MessageInput
            initialMessage={editingMessageText}
            onSendMessage={(updatedMessage) => handleSubmitEdit(updatedMessage)}
            isLoading={isLoading}
            onToggleFileUpload={() => { }}
            hasFiles={false}
            isEditing={true}
            onCancelEdit={handleCancelEdit}
          />
        ) : (
          <MessageInput
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            onToggleFileUpload={() => setShowFileUploadDialog(true)}
            hasFiles={uploadedFiles.length > 0}
          />
        )}
      </div>

      {/* File Upload Dialog - controlled by external state */}
      <FileUpload
        onFileUpload={handleFileUpload}
        onFileRemove={handleRemoveFile}
        uploadedFiles={uploadedFiles}
        isProcessing={isProcessing}
        isDialogOpen={showFileUploadDialog}
        onDialogClose={() => setShowFileUploadDialog(false)}
      />
    </div>
  )
}

export default ChatArea