import React from "react";
import {theme} from "../theme";

export const Brand = ({compact = false}: {compact?: boolean}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
      color: theme.moss,
      fontFamily: theme.font,
      fontWeight: 800,
      letterSpacing: 0,
      fontSize: compact ? 22 : 30,
    }}
  >
    <div
      style={{
        width: compact ? 30 : 40,
        height: compact ? 30 : 40,
        position: "relative",
      }}
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          style={{
            position: "absolute",
            left: compact ? 4 : 5,
            right: compact ? 4 : 5,
            bottom: index * (compact ? 8 : 10),
            height: compact ? 7 : 9,
            borderRadius: 999,
            background: theme.moss,
          }}
        />
      ))}
    </div>
    <span>{compact ? "> cairn" : "cairn"}</span>
  </div>
);
