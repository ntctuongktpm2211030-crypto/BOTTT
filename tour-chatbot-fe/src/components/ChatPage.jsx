// ==== CẮT NGẮN: GIỮ NGUYÊN CODE CŨ CỦA BẠN ====
// Chỉ thêm phần suggestion button + logic gửi

import React, { useState, useRef, useEffect } from "react";

const DEFAULT_BACKEND_URL = "http://localhost:5000";

const ChatPage = () => {
  const backendUrl = DEFAULT_BACKEND_URL;
  const [messages, setMessages] = useState([
    {
      id: "welcome-1",
      role: "assistant",
      text:
        "Xin chào, mình là trợ lý du lịch ✈️\n" +
        "Bạn có thể hỏi mình về: địa điểm, lịch trình, ăn ở, di chuyển...\n\n" +
        "Bạn đang muốn đi đâu và khoảng mấy ngày?",
    },
  ]);

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const chatRef = useRef(null);
  const inputRef = useRef(null);

  // ===== QUICK SUGGESTIONS =====
  const suggestions = [
    "Đà Nẵng 4N3Đ cho cặp đôi",
    "Đà Lạt 3N2Đ nên đi đâu?",
    "Phú Quốc ăn gì ngon?",
    "Hà Giang tháng 10 có đẹp không?",
    "Gợi ý tour Nha Trang 2N1Đ",
  ];

  // Auto scroll
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Auto focus input khi mở
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ===== GỬI TIN NHẮN =====
  const handleSend = async (customText = null) => {
    const msgText = customText || input.trim();
    if (!msgText || isLoading) return;

    // thêm message user
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", text: msgText },
    ]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch(`${backendUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msgText }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errorMsg =
          data?.error ||
          `Lỗi server (HTTP ${res.status}). Vui lòng thử lại sau.`;
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            text: `⚠️ ${errorMsg}`,
          },
        ]);
      } else {
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-${Date.now()}`,
            role: "assistant",
            text: data.reply || "Mình chưa nhận được nội dung trả lời.",
          },
        ]);
      }
    } catch (err) {
      console.error("FE error:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          text:
            "⚠️ Không kết nối được backend. Kiểm tra server backend tại localhost:5000.",
        },
      ]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  function stripMarkdown(text) {
  return text
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/_/g, "")
    .replace(/#+\s?/g, "")
    .replace(/>\s?/g, "");
}


  // ===== RENDER UI MESSAGE =====
  const renderMessage = (msg) => {
    const isUser = msg.role === "user";

    return (
      <div
        key={msg.id}
        className={`flex w-full mb-3 ${
          isUser ? "justify-end" : "justify-start"
        }`}
      >
        {!isUser && (
          <div className="mr-2 mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/90 text-white text-sm shadow-md">
            🤖
          </div>
        )}

        <div
          className={`
            max-w-[80%] whitespace-pre-line rounded-2xl px-4 py-2 text-sm leading-relaxed
            shadow-md
            ${
              isUser
                ? "bg-sky-500 text-white rounded-br-md"
                : "bg-slate-800/90 text-slate-50 rounded-bl-md border border-slate-700/70"
            }
          `}
        >
          {stripMarkdown(msg.text)}
        </div>

        {isUser && (
          <div className="ml-2 mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white text-sm shadow-md">
            🧑
          </div>
        )}
      </div>
    );
  };

  // ===== MAIN UI =====
  return (
    <div className="h-[540px] w-full flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50 border border-slate-800/60 rounded-2xl overflow-hidden shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 bg-slate-950/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-sky-500 to-cyan-400 flex items-center justify-center text-white text-lg shadow-md">
            ✈️
          </div>
          <div>
            <div className="text-sm font-semibold">Travel AI Assistant</div>
            <div className="text-[11px] text-slate-400">
              Gợi ý địa điểm – lịch trình – món ăn – chi phí
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Online</span>
        </div>
      </div>

      {/* Chat body */}
      <div
        ref={chatRef}
        className="flex-1 overflow-y-auto px-4 py-3 bg-gradient-to-b from-slate-950/90 to-slate-900/95"
      >
        {messages.map(renderMessage)}

        {isLoading && (
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <span className="flex gap-1">
              <span className="h-2 w-2 rounded-full bg-slate-500 animate-bounce" />
              <span className="h-2 w-2 rounded-full bg-slate-500 animate-bounce delay-100" />
              <span className="h-2 w-2 rounded-full bg-slate-500 animate-bounce delay-200" />
            </span>
            Mình đang suy nghĩ gợi ý cho bạn...
          </div>
        )}
      </div>

      {/* ===== QUICK SUGGESTION BUTTONS ===== */}
      <div className="px-3 py-2 bg-slate-950/90 border-t border-slate-800">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scroll">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => handleSend(s)}
              className="flex-shrink-0 bg-slate-800 text-slate-200 text-xs px-3 py-1.5 rounded-xl border border-slate-700 hover:bg-slate-700 transition shadow-sm"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-slate-800 bg-slate-950/90 px-3 py-2">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            className="flex-1 resize-none rounded-2xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 h-12 max-h-32"
            placeholder="Nhập câu hỏi du lịch của bạn..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={() => handleSend()}
            disabled={isLoading || !input.trim()}
            className={`flex h-10 px-5 items-center justify-center rounded-2xl text-sm font-semibold shadow-md transition
              ${
                isLoading || !input.trim()
                  ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                  : "bg-gradient-to-tr from-sky-500 to-cyan-400 text-black hover:from-sky-400 hover:to-cyan-300"
              }`}
          >
            {isLoading ? "..." : "Gửi"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPage;
