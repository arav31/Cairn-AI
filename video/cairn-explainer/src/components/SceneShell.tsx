import React from "react";
import type {Scene} from "../storyboard";
import {shadow, theme} from "../theme";
import {exitProgress, useSceneFrame} from "../timing";
import {Brand} from "./Brand";
import {StockVideo} from "./StockVideo";
import {Wavefield} from "./Wavefield";

type SceneShellProps = {
  scene: Scene;
  children: React.ReactNode;
  imageAlign?: "left" | "right" | "center";
  dark?: boolean;
};

export const SceneShell = ({
  scene,
  children,
  imageAlign = "right",
  dark = false,
}: SceneShellProps) => {
  const {frame, fps} = useSceneFrame();
  const exit = exitProgress(frame, fps, scene.end - scene.start - 0.55, 0.5);
  const opacity = 1 - exit;
  const y = exit * -22;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: dark ? theme.dark : theme.bg,
        color: dark ? theme.bg2 : theme.ink,
        fontFamily: theme.font,
      }}
      >
        <Wavefield variant={dark ? "dark" : "light"} />
      <StockVideo asset={scene.asset} align={imageAlign} opacity={dark ? 0.18 : 0.34} />
      <div
        style={{
          position: "absolute",
          top: 46,
          left: 68,
          right: 68,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          opacity: 0.95,
        }}
      >
        <Brand compact />
        <div
          style={{
            fontSize: 18,
            color: dark ? "rgba(255, 248, 234, 0.72)" : theme.muted,
          }}
        >
          {scene.kicker}
        </div>
      </div>
      <main
        style={{
          position: "absolute",
          inset: "128px 68px 76px",
          opacity,
          transform: `translateY(${y}px)`,
        }}
      >
        {children}
      </main>
      <div
        style={{
          position: "absolute",
          left: 68,
          right: 68,
          bottom: 42,
          height: 1,
          background: dark ? "rgba(255,248,234,0.18)" : theme.line,
          boxShadow: shadow,
        }}
      />
    </div>
  );
};
