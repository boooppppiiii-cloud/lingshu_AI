import ReactMarkdown from 'react-markdown';

type AssistantReplyMarkdownProps = {
  text: string;
  className?: string;
};

/** SA小三郎回复：分点 + 行首 **关键词** 加粗加黑 */
export default function AssistantReplyMarkdown({ text, className = '' }: AssistantReplyMarkdownProps) {
  return (
    <div className={`assistant-reply ${className}`.trim()}>
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-1.5 list-disc space-y-1 pl-3.5 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-1.5 list-decimal space-y-1 pl-3.5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-black text-slate-900">{children}</strong>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
