interface SearchHighlightProps {
  text: string;
}

export function SearchHighlight({ text }: SearchHighlightProps) {
  const parts: Array<{ text: string; highlighted: boolean }> = [];
  const pattern = /<<(.*?)>>/gs;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;

    if (index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, index), highlighted: false });
    }

    parts.push({ text: match[1] ?? "", highlighted: true });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), highlighted: false });
  }

  if (parts.length === 0) {
    return <>{text}</>;
  }

  return (
    <>
      {parts.map((part, index) =>
        part.highlighted ? (
          <mark key={`${part.text}-${index}`} className="rounded bg-yellow-200/70 px-0.5 text-inherit">
            {part.text}
          </mark>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        ),
      )}
    </>
  );
}
