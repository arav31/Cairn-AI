import React from "react";
import {shadow, theme} from "../theme";
import {enterProgress, useSceneFrame} from "../timing";

export const Panel = ({
  children,
  style,
  dark = false,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  dark?: boolean;
}) => (
  <div
    style={{
      border: `1px solid ${dark ? "rgba(255,248,234,0.18)" : theme.line}`,
      background: dark ? "rgba(255,248,234,0.08)" : theme.panel,
      boxShadow: dark ? "none" : shadow,
      borderRadius: 8,
      ...style,
    }}
  >
    {children}
  </div>
);

export const BrowserWindow = ({
  children,
  title,
  style,
}: {
  children: React.ReactNode;
  title: string;
  style?: React.CSSProperties;
}) => (
  <Panel
    style={{
      overflow: "hidden",
      ...style,
    }}
  >
    <div
      style={{
        height: 56,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 20px",
        borderBottom: `1px solid ${theme.line}`,
        background: "rgba(255,248,234,0.88)",
      }}
    >
      {[0, 1, 2].map((dot) => (
        <div
          key={dot}
          style={{
            width: 12,
            height: 12,
            borderRadius: 99,
            background: dot === 0 ? "#9f3434" : dot === 1 ? "#bda44a" : theme.moss,
            opacity: 0.82,
          }}
        />
      ))}
      <div
        style={{
          marginLeft: 12,
          color: theme.muted,
          fontSize: 18,
        }}
      >
        {title}
      </div>
    </div>
    {children}
  </Panel>
);

export const Staggered = ({
  children,
  index,
  baseDelay = 0.2,
  step = 0.1,
}: {
  children: React.ReactNode;
  index: number;
  baseDelay?: number;
  step?: number;
}) => {
  const {frame, fps} = useSceneFrame();
  const enter = enterProgress(frame, fps, baseDelay + index * step, 0.55);
  return (
    <div
      style={{
        opacity: enter,
        transform: `translateY(${(1 - enter) * 18}px)`,
      }}
    >
      {children}
    </div>
  );
};
