import ReactMarkdown from "react-markdown";

interface Props {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: Props) {
  if (!content) {
    return <p className="text-sm text-muted-foreground">No content.</p>;
  }

  return (
    <div
      className={[
        "prose prose-sm max-w-none",
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-a:text-primary prose-a:underline-offset-4",
        "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:rounded-md prose-pre:border prose-pre:bg-muted prose-pre:text-xs",
        "prose-blockquote:border-l-primary/40 prose-blockquote:text-muted-foreground",
        "prose-li:my-0.5",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
