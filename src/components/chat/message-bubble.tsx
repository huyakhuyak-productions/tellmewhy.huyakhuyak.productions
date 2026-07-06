import { Streamdown } from "streamdown";

export function MessageBubble({
  role,
  text,
}: {
  role: "user" | "assistant";
  text: string;
}) {
  if (role === "user") {
    return (
      <div className="animate-message-rise ml-auto max-w-[85%] text-pretty rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[0.975rem] leading-relaxed text-accent-foreground shadow-sm">
        {text}
      </div>
    );
  }
  return (
    <div className="animate-message-rise mr-auto max-w-[88%] text-pretty rounded-2xl rounded-bl-md bg-muted px-4 py-3 text-[0.975rem] leading-relaxed shadow-sm [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-background/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <Streamdown>{text}</Streamdown>
    </div>
  );
}
