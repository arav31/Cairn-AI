import React from "react";
import {theme} from "../theme";

export const Eyebrow = ({children, dark = false}: {children: React.ReactNode; dark?: boolean}) => (
  <div
    style={{
      color: dark ? "#b7d4a2" : theme.moss,
      fontSize: 24,
      fontWeight: 800,
      letterSpacing: 0,
      marginBottom: 24,
    }}
  >
    {children}
  </div>
);

export const Title = ({
  children,
  size = 84,
  maxWidth = 980,
  dark = false,
}: {
  children: React.ReactNode;
  size?: number;
  maxWidth?: number;
  dark?: boolean;
}) => (
  <h1
    style={{
      margin: 0,
      maxWidth,
      color: dark ? theme.bg2 : theme.ink,
      fontSize: size,
      lineHeight: 1.02,
      fontWeight: 900,
      letterSpacing: 0,
    }}
  >
    {children}
  </h1>
);

export const Body = ({
  children,
  maxWidth = 820,
  dark = false,
}: {
  children: React.ReactNode;
  maxWidth?: number;
  dark?: boolean;
}) => (
  <p
    style={{
      margin: "30px 0 0",
      maxWidth,
      color: dark ? "rgba(255,248,234,0.82)" : theme.body,
      fontSize: 32,
      lineHeight: 1.55,
      letterSpacing: 0,
    }}
  >
    {children}
  </p>
);
