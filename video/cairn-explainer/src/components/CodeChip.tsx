import React from "react";
import {rounded, theme} from "../theme";

export const CodeChip = ({
  children,
  tone = "moss",
}: {
  children: React.ReactNode;
  tone?: "moss" | "teal" | "dark";
}) => {
  const color = tone === "teal" ? theme.teal : tone === "dark" ? theme.dark : theme.moss;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 46,
        padding: "0 18px",
        borderRadius: rounded,
        border: `1px solid ${theme.lineStrong}`,
        background: "rgba(255, 248, 234, 0.82)",
        color,
        fontFamily: theme.font,
        fontSize: 22,
        fontWeight: 800,
        letterSpacing: 0,
      }}
    >
      {children}
    </div>
  );
};
