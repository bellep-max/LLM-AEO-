import { useState, useRef, useEffect } from "react";
import { Send, Plus, Trash2, TerminalSquare } from "lucide-react";
import { 
  useListOpenaiConversations, 
  getListOpenaiConversationsQueryKey,
  useCreateOpenaiConversation,
  useDeleteOpenaiConversation,
  useListOpenaiMessages,
  getListOpenaiMessagesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export function ChatPage() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [], isLoading: loadingConversations } = useListOpenaiConversations();
  const { data: messages = [], isLoading: loadingMessages } = useListOpenaiMessages(
    activeId ?? 0, 
    { query: { enabled: !!activeId, queryKey: getListOpenaiMessagesQueryKey(activeId ?? 0) } }
  );

  const createConv = useCreateOpenaiConversation();
  const deleteConv = useDeleteOpenaiConversation();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  const handleNewConversation = () => {
    setActiveId(null);
  };

  const handleDelete = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteConv.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
        if (activeId === id) setActiveId(null);
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userContent = input.trim();
    setInput("");
    
    let targetId = activeId;

    if (!targetId) {
      try {
        const newConv = await createConv.mutateAsync({
          data: { title: userContent.substring(0, 50) + (userContent.length > 50 ? "..." : "") }
        });
        targetId = newConv.id;
        setActiveId(targetId);
        queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
      } catch (e) {
        console.error("Failed to create conversation", e);
        return;
      }
    }

    const previousMessages = queryClient.getQueryData(getListOpenaiMessagesQueryKey(targetId)) as any[];
    queryClient.setQueryData(getListOpenaiMessagesQueryKey(targetId), (old: any) => {
      return [...(old || []), { id: Date.now(), role: "user", content: userContent, createdAt: new Date().toISOString() }];
    });

    setIsStreaming(true);
    setStreamingText("");

    try {
      const res = await fetch(`/api/openai/conversations/${targetId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: userContent })
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);
          if (!jsonStr) continue;
          try {
            const json = JSON.parse(jsonStr);
            if (json.done) break;
            if (json.content) setStreamingText(prev => prev + json.content);
          } catch (e) {
            console.error("Failed to parse SSE", e);
          }
        }
      }
    } catch (error) {
      console.error("Streaming error", error);
    } finally {
      setIsStreaming(false);
      queryClient.invalidateQueries({ queryKey: getListOpenaiMessagesQueryKey(targetId) });
      queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
    }
  };

  return (
    <div className="flex h-full w-full">
      <div className="w-72 border-r border-border bg-card/50 flex flex-col">
        <div className="p-4 border-b border-border">
          <Button 
            className="w-full gap-2" 
            onClick={handleNewConversation}
            disabled={createConv.isPending}
            data-testid="button-new-conversation"
          >
            <Plus className="w-4 h-4" />
            New Conversation
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {loadingConversations ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
            ) : conversations.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">No conversations yet</div>
            ) : (
              conversations.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => setActiveId(conv.id)}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-md cursor-pointer transition-colors group text-sm",
                    activeId === conv.id 
                      ? "bg-secondary text-foreground" 
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  )}
                  data-testid={`conv-item-${conv.id}`}
                >
                  <div className="truncate pr-2 flex-1">
                    {conv.title || "Untitled Conversation"}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-0 group-hover:opacity-100 h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={(e) => handleDelete(conv.id, e)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col bg-background relative">
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6"
        >
          {!activeId && messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
              <TerminalSquare className="w-12 h-12 mb-4" />
              <p>Ready for input.</p>
            </div>
          ) : (
            <>
              {loadingMessages && activeId ? (
                <div className="text-center text-muted-foreground">Loading messages...</div>
              ) : messages.map((msg: any) => (
                <div 
                  key={msg.id} 
                  className={cn(
                    "max-w-2xl flex flex-col",
                    msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
                  )}
                >
                  <div 
                    className={cn(
                      "px-4 py-3 rounded-lg text-sm leading-relaxed",
                      msg.role === "user" 
                        ? "bg-primary text-primary-foreground" 
                        : "bg-secondary text-foreground"
                    )}
                  >
                    {msg.content}
                  </div>
                  {msg.role === "assistant" && (msg.tokensUsed || msg.responseTimeMs) && (
                    <div className="text-[10px] text-muted-foreground mt-1 px-1 flex gap-2">
                      {msg.tokensUsed && <span>{msg.tokensUsed} tokens</span>}
                      {msg.responseTimeMs && <span>{msg.responseTimeMs}ms</span>}
                    </div>
                  )}
                </div>
              ))}
              
              {isStreaming && streamingText && (
                <div className="max-w-2xl mr-auto items-start flex flex-col">
                  <div className="px-4 py-3 rounded-lg text-sm leading-relaxed bg-secondary text-foreground border border-primary/20">
                    {streamingText}
                    <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-primary animate-pulse" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-border bg-card/30">
          <form 
            onSubmit={handleSubmit}
            className="max-w-3xl mx-auto relative flex items-center"
          >
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Query the model..."
              className="pr-12 bg-card border-muted focus-visible:ring-primary/50"
              disabled={isStreaming}
            />
            <Button 
              type="submit" 
              size="icon"
              className="absolute right-1 h-8 w-8"
              disabled={!input.trim() || isStreaming}
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
