import React from "react";
import {interpolate} from "remotion";
import {theme} from "../theme";
import {clamp, drift, useSceneFrame} from "../timing";

export const Wavefield = ({variant = "light"}: {variant?: "light" | "dark"}) => {
  const {frame, fps} = useSceneFrame();
  const sweep = interpolate(frame, [0, 90 * fps], [-240, 420], clamp);
  const darkness = variant === "dark";
  const dotColor = darkness ? "rgba(255, 248, 234, 0.12)" : "rgba(53, 73, 34, 0.13)";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: darkness ? theme.dark : theme.bg,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `radial-gradient(${dotColor} 1.25px, transparent 1.25px)`,
          backgroundSize: "18px 18px",
          transform: `translate(${drift(frame, 20, 95)}px, ${drift(frame, 14, 130)}px)`,
          opacity: 0.72,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 1500,
          height: 1500,
          right: -320 + drift(frame, 18, 150),
          top: -420 + drift(frame, 24, 190),
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(79, 127, 42, ${
            darkness ? 0.22 : 0.24
          }) 0%, rgba(35, 95, 99, 0.14) 35%, transparent 68%)`,
          opacity: 0.9,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: sweep,
          top: -200,
          width: 320,
          height: 1500,
          transform: "rotate(18deg)",
          background:
            "linear-gradient(90deg, transparent, rgba(255, 248, 234, 0.38), transparent)",
          opacity: darkness ? 0.16 : 0.34,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(255, 248, 234, 0.26), transparent 42%, rgba(21, 32, 22, 0.06))",
        }}
      />
    </div>
  );
};
