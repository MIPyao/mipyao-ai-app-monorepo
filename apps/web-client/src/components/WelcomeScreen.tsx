import { Bot, FileText, Sparkles, MessageSquare } from "lucide-react";

interface WelcomeScreenProps {
  onSuggestionClick: (text: string) => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onSuggestionClick,
}) => {
  const suggestions = [
    {
      icon: <FileText className="w-4 h-4 text-blue-500" />,
      text: "赵耀掌握的专业技能有哪些？",
    },
    {
      icon: <Sparkles className="w-4 h-4 text-amber-500" />,
      text: "科技部野外台站数据可视化大屏项目用了什么技术？",
    },
    {
      icon: <MessageSquare className="w-4 h-4 text-emerald-500" />,
      text: "他的工作经历有哪些？",
    },
    {
      icon: <Bot className="w-4 h-4 text-purple-500" />,
      text: "谈一谈赵耀的项目经历。",
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4 space-y-8 animate-in fade-in duration-500 slide-in-from-bottom-4">
      <div className="bg-white p-4 rounded-full shadow-lg border border-gray-100 ring-4 ring-gray-50">
        <Bot className="w-12 h-12 text-indigo-600" />
      </div>

      <div className="space-y-2 max-w-lg">
        <h2 className="text-2xl font-bold text-slate-800">很高兴为您服务</h2>
        <p className="text-slate-500">
          我是您的智能简历助手。利用 RAG
          技术，我可以回答关于赵耀简历的任何细节。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl mt-4">
        {suggestions.map((item, index) => (
          <button
            key={index}
            onClick={() => onSuggestionClick(item.text)}
            className="flex items-center gap-3 p-4 bg-white border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all duration-200 rounded-xl text-left group"
          >
            <div className="p-2 bg-gray-50 group-hover:bg-white rounded-lg transition-colors">
              {item.icon}
            </div>
            <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-700">
              {item.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
