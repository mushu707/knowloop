import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** 题干与解析支持 Markdown（含代码块）。react-markdown 默认不渲染原始 HTML，避免本地内容注入。 */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
}
