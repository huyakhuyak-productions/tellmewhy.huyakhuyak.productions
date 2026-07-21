// The app's single error voice — a calm, quiet inline note in the room idiom
// (serif italic, accent-toned), never a red alarm. Every form that has to tell
// someone something went wrong reaches for this so the whole product speaks in
// one register. Purely presentational, so it drops into client and server trees
// alike.
export function InlineError({ message }: { message: string }) {
  return (
    <p role="alert" className="font-serif text-[12.5px] italic leading-relaxed text-accent">
      {message}
    </p>
  );
}
