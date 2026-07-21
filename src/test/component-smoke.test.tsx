// @vitest-environment happy-dom
// Proves the component-test harness itself: happy-dom gives us a DOM, React
// mounts into it, Testing Library queries it, and the shared browser-API stubs
// load without touching the node-environment suite. If this file goes red, the
// harness is broken — not the app.
import "./component-setup";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      count: {count}
    </button>
  );
}

describe("component-test harness", () => {
  it("renders a React component into happy-dom and reflects state updates", () => {
    render(<Counter />);
    const button = screen.getByRole("button");
    expect(button.textContent).toBe("count: 0");

    fireEvent.click(button);
    expect(button.textContent).toBe("count: 1");
  });

  it("exposes the stubbed browser APIs the reading view depends on", () => {
    expect(typeof window.matchMedia).toBe("function");
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
    expect(typeof window.ResizeObserver).toBe("function");
    expect(typeof Element.prototype.scrollIntoView).toBe("function");
  });
});
