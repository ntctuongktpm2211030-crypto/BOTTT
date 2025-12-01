import React from "react";
import ChatPage from "./components/ChatPage";

const App = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-100 via-slate-100 to-emerald-100">
      <div className="w-full max-w-5xl px-3 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-800">
            </h1>
          </div>
        </div>

        <div className="bg-white/90 backdrop-blur-sm shadow-xl rounded-2xl border border-slate-200 overflow-hidden">
          <ChatPage />
        </div>
      </div>
    </div>
  );
};

export default App;
