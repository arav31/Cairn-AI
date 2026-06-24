import {Video} from "@remotion/media";
import React from "react";
import {interpolate, staticFile} from "remotion";
import type {SceneAsset} from "../storyboard";
import {theme} from "../theme";
import {clamp, useSceneFrame} from "../timing";

type StockVideoProps = {
  asset?: SceneAsset;
  align?: "left" | "right" | "center";
  opacity?: number;
};

export const StockVideo = ({asset, align = "right", opacity = 0.34}: StockVideoProps) => {
  const {frame} = useSceneFrame();
  if (!asset || asset.kind !== "stock-video") {
    return null;
  }
  const scale = interpolate(frame, [0, 420], [1.035, 1.09], clamp);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
      }}
    >
      <Video
        src={staticFile(asset.path)}
        muted
        loop
        objectFit="cover"
        style={{
          position: "absolute",
          top: -44,
          bottom: -44,
          left: align === "right" ? 680 : -120,
          width: align === "center" ? 2160 : 1360,
          height: 1168,
          filter: "grayscale(0.18) saturate(0.82) contrast(0.9)",
          opacity,
          transform: `scale(${scale})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            align === "right"
              ? `linear-gradient(90deg, ${theme.bg} 0%, rgba(239,229,209,0.94) 34%, rgba(239,229,209,0.4) 74%, ${theme.bg} 100%)`
              : `linear-gradient(90deg, rgba(239,229,209,0.42), ${theme.bg} 62%, ${theme.bg})`,
        }}
      />
    </div>
  );
};
