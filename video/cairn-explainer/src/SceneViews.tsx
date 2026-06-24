import {Video} from "@remotion/media";
import React from "react";
import {interpolate, staticFile} from "remotion";
import type {Scene} from "./storyboard";
import {shadow, theme} from "./theme";
import {clamp, drift, enterProgress, useSceneFrame} from "./timing";
import {Brand} from "./components/Brand";
import {CodeChip} from "./components/CodeChip";
import {BrowserWindow, Panel, Staggered} from "./components/Panels";
import {Body, Eyebrow, Title} from "./components/Typography";

type SceneViewProps = {
  scene: Scene;
  showcaseVideoAvailable?: boolean;
};

const StepPill = ({label, index}: {label: string; index: number}) => {
  const {frame, fps} = useSceneFrame();
  const pulse = interpolate(
    Math.sin((frame + index * 18) / 18),
    [-1, 1],
    [0.68, 1],
    clamp,
  );
  return (
    <Staggered index={index}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          height: 70,
          padding: "0 22px",
          border: `1px solid ${theme.line}`,
          borderRadius: 8,
          background: "rgba(255,248,234,0.74)",
          color: theme.body,
          fontSize: 23,
          boxShadow: index % 2 === 0 ? shadow : undefined,
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 99,
            background: index % 2 === 0 ? theme.moss : theme.teal,
            opacity: pulse,
          }}
        />
        {label}
      </div>
    </Staggered>
  );
};

const LabelGrid = ({labels, dark = false}: {labels: string[]; dark?: boolean}) => (
  <div style={{display: "flex", gap: 14, flexWrap: "wrap", marginTop: 34}}>
    {labels.map((label, index) => (
      <Staggered key={label} index={index} baseDelay={0.42} step={0.08}>
        <CodeChip tone={dark ? "teal" : index % 2 === 0 ? "moss" : "teal"}>
          {label}
        </CodeChip>
      </Staggered>
    ))}
  </div>
);

export const ColdOpen = ({scene}: SceneViewProps) => {
  const {frame, fps} = useSceneFrame();
  const title = enterProgress(frame, fps, 0.15, 0.9);
  return (
    <div style={{height: "100%", display: "grid", placeItems: "center"}}>
      <div style={{width: 1280}}>
        <div style={{opacity: title, transform: `translateY(${(1 - title) * 24}px)`}}>
          <Brand />
          <div style={{height: 44}} />
          <Title size={92} maxWidth={1220}>
            {scene.title}
          </Title>
          <Body maxWidth={1010}>{scene.body}</Body>
          <LabelGrid labels={scene.labels} />
        </div>
      </div>
    </div>
  );
};

export const BrowserLoop = ({scene}: SceneViewProps) => {
  const steps = ["observe page", "plan click", "wait for UI", "read screenshot", "fill form", "retry drift"];
  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        gridTemplateColumns: "0.95fr 1.05fr",
        gap: 56,
        alignItems: "center",
      }}
    >
      <div>
        <Eyebrow>{scene.kicker}</Eyebrow>
        <Title size={72}>{scene.title}</Title>
        <Body>{scene.body}</Body>
        <LabelGrid labels={scene.labels} />
      </div>
      <BrowserWindow title="agent-browser-run/loop" style={{height: 650}}>
        <div style={{padding: 34, display: "grid", gap: 18}}>
          {steps.map((step, index) => (
            <StepPill key={step} label={step} index={index} />
          ))}
          <Panel
            style={{
              marginTop: 16,
              padding: 24,
              background: "rgba(21,32,22,0.88)",
              color: theme.bg2,
            }}
          >
            <div style={{fontSize: 20, color: "#b7d4a2"}}>$ run repeated-browser-task</div>
            <div style={{fontSize: 18, lineHeight: 1.8, marginTop: 14, color: "rgba(255,248,234,0.78)"}}>
              tokens += observation + planning + screenshots + retries
            </div>
          </Panel>
        </div>
      </BrowserWindow>
    </div>
  );
};

export const RepetitionCost = ({scene}: SceneViewProps) => {
  const {frame} = useSceneFrame();
  const lineX = interpolate(frame, [22, 140], [0, 1], clamp);
  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        gridTemplateColumns: "1.02fr 0.98fr",
        gap: 64,
        alignItems: "center",
      }}
    >
      <div>
        <Eyebrow>{scene.kicker}</Eyebrow>
        <Title size={70}>{scene.title}</Title>
        <Body>{scene.body}</Body>
        <LabelGrid labels={scene.labels} />
      </div>
      <Panel style={{height: 620, padding: 38, position: "relative", overflow: "hidden"}}>
        {[0, 1, 2].map((index) => (
          <Staggered key={index} index={index} baseDelay={0.2}>
            <div
              style={{
                height: 112,
                marginBottom: 24,
                border: `1px solid ${theme.line}`,
                borderRadius: 8,
                background: "rgba(255,248,234,0.84)",
                display: "grid",
                gridTemplateColumns: "130px 1fr 110px",
                alignItems: "center",
                padding: "0 24px",
                color: theme.body,
                fontSize: 22,
              }}
            >
              <strong style={{color: theme.moss}}>run {index + 1}</strong>
              <span>discover clicks, waits, selectors, success state</span>
              <span style={{color: theme.teal}}>+tokens</span>
            </div>
          </Staggered>
        ))}
        <div
          style={{
            position: "absolute",
            left: 80,
            right: 80,
            bottom: 92,
            height: 3,
            background: theme.line,
          }}
        >
          <div
            style={{
              width: `${lineX * 100}%`,
              height: "100%",
              background: theme.moss,
            }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            left: 152,
            right: 152,
            bottom: 36,
            height: 82,
            display: "grid",
            placeItems: "center",
            borderRadius: 8,
            background: theme.dark,
            color: theme.bg2,
            fontSize: 25,
            fontWeight: 800,
          }}
        >
          {"compile once -> reusable contract"}
        </div>
      </Panel>
    </div>
  );
};

export const RecordOnce = ({scene}: SceneViewProps) => (
  <div
    style={{
      height: "100%",
      display: "grid",
      gridTemplateColumns: "0.92fr 1.08fr",
      gap: 56,
      alignItems: "center",
    }}
  >
    <div>
      <Eyebrow>{scene.kicker}</Eyebrow>
      <Title size={78}>{scene.title}</Title>
      <Body>{scene.body}</Body>
      <LabelGrid labels={scene.labels} />
    </div>
    <div style={{position: "relative", height: 640}}>
      <BrowserWindow title="authorized-session/recording" style={{position: "absolute", inset: "0 220px 80px 0"}}>
        <div style={{padding: 34}}>
          {["open target", "submit form", "confirm result", "capture flow"].map((item, index) => (
            <StepPill key={item} label={item} index={index} />
          ))}
        </div>
      </BrowserWindow>
      <Panel
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: 420,
          padding: 28,
          background: theme.dark,
          color: theme.bg2,
        }}
      >
        <div style={{fontSize: 20, color: "#b7d4a2", marginBottom: 18}}>operation.json</div>
        {["input schema", "request graph", "success predicate", "required scopes"].map((item) => (
          <div key={item} style={{fontSize: 22, padding: "11px 0", borderTop: "1px solid rgba(255,248,234,0.14)"}}>
            {item}
          </div>
        ))}
      </Panel>
    </div>
  </div>
);

export const TypedApi = ({scene}: SceneViewProps) => {
  const endpoints = [
    ["POST", "/api/tools/:slug/invoke"],
    ["GET", "/openapi.json"],
    ["MCP", "tools/list + tools/call"],
    ["SDK", "cairn.invoke(slug, input)"],
    ["CLI", "cairn call --api"],
  ];
  return (
    <div style={{height: "100%", display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 64, alignItems: "center"}}>
      <div>
        <Eyebrow>{scene.kicker}</Eyebrow>
        <Title size={72}>{scene.title}</Title>
        <Body>{scene.body}</Body>
        <LabelGrid labels={scene.labels} />
      </div>
      <Panel style={{padding: 34, background: "rgba(255,248,234,0.88)"}}>
        <div style={{fontSize: 24, color: theme.moss, fontWeight: 800, marginBottom: 22}}>
          {"workflow -> durable endpoints"}
        </div>
        <div style={{display: "grid", gap: 16}}>
          {endpoints.map(([method, path], index) => (
            <Staggered key={method} index={index}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 1fr",
                  alignItems: "center",
                  minHeight: 82,
                  padding: "0 24px",
                  border: `1px solid ${theme.line}`,
                  borderRadius: 8,
                  background: index === 0 ? theme.dark : "rgba(255,248,234,0.82)",
                  color: index === 0 ? theme.bg2 : theme.body,
                  fontSize: 24,
                }}
              >
                <strong style={{color: index === 0 ? "#b7d4a2" : theme.teal}}>{method}</strong>
                <span>{path}</span>
              </div>
            </Staggered>
          ))}
        </div>
      </Panel>
    </div>
  );
};

export const ShowcaseScene = ({scene, showcaseVideoAvailable = false}: SceneViewProps) => (
  <div style={{height: "100%", display: "grid", placeItems: "center"}}>
    <Panel
      style={{
        width: 1320,
        height: 675,
        overflow: "hidden",
        position: "relative",
        background: theme.dark,
        color: theme.bg2,
      }}
      dark
    >
      {showcaseVideoAvailable ? (
        <Video
          src={staticFile("assets/showcase/cairn-showcase.mp4")}
          muted
          objectFit="cover"
          style={{width: "100%", height: "100%"}}
        />
      ) : (
        <div style={{position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 76}}>
          <div style={{textAlign: "center"}}>
            <Brand />
            <div style={{height: 42}} />
            <Title size={58} maxWidth={1080} dark>
              {scene.title}
            </Title>
            <Body maxWidth={1040} dark>
              {scene.body}
            </Body>
            <div style={{display: "flex", justifyContent: "center"}}>
              <LabelGrid labels={scene.labels} dark />
            </div>
          </div>
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: 28,
          right: 28,
          bottom: 24,
          height: 10,
          borderRadius: 99,
          background: "rgba(255,248,234,0.14)",
          overflow: "hidden",
        }}
      >
        <div style={{width: "62%", height: "100%", background: theme.moss}} />
      </div>
    </Panel>
  </div>
);

export const Reliability = ({scene}: SceneViewProps) => {
  const {frame, fps} = useSceneFrame();
  const progress = enterProgress(frame, fps, 0.3, 1.5);
  const states = ["verified", "drift detected", "repair candidate", "verified again"];
  return (
    <div style={{height: "100%", display: "grid", gridTemplateColumns: "0.95fr 1.05fr", gap: 64, alignItems: "center"}}>
      <div>
        <Eyebrow>{scene.kicker}</Eyebrow>
        <Title size={72}>{scene.title}</Title>
        <Body>{scene.body}</Body>
        <LabelGrid labels={scene.labels} />
      </div>
      <Panel style={{height: 580, padding: 44, position: "relative"}}>
        <div
          style={{
            position: "absolute",
            top: 110,
            bottom: 110,
            left: 86,
            width: 4,
            background: theme.line,
          }}
        >
          <div style={{height: `${progress * 100}%`, width: "100%", background: theme.moss}} />
        </div>
        <div style={{display: "grid", gap: 30}}>
          {states.map((state, index) => (
            <Staggered key={state} index={index} baseDelay={0.25} step={0.18}>
              <div style={{display: "grid", gridTemplateColumns: "86px 1fr", alignItems: "center", minHeight: 96}}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 99,
                    background: index === 1 ? theme.teal : theme.moss,
                    boxShadow: `0 0 0 10px ${theme.bg2}`,
                  }}
                />
                <div>
                  <div style={{fontSize: 28, color: theme.ink, fontWeight: 800}}>{state}</div>
                  <div style={{fontSize: 20, color: theme.muted, marginTop: 8}}>
                    {index === 0 && "deterministic replay passes"}
                    {index === 1 && "target changed underneath"}
                    {index === 2 && "new plan generated from fresh trace"}
                    {index === 3 && "same stable contract for agents"}
                  </div>
                </div>
              </div>
            </Staggered>
          ))}
        </div>
      </Panel>
    </div>
  );
};

export const Conclusion = ({scene}: SceneViewProps) => {
  const {frame} = useSceneFrame();
  return (
    <div style={{height: "100%", display: "grid", placeItems: "center"}}>
      <div style={{textAlign: "center", width: 1280}}>
        <div style={{transform: `translateY(${drift(frame, 8, 110)}px)`, display: "flex", justifyContent: "center"}}>
          <Brand />
        </div>
        <div style={{height: 52}} />
        <Title size={82} maxWidth={1280}>
          {scene.title}
        </Title>
        <Body maxWidth={1120}>{scene.body}</Body>
        <div style={{display: "flex", justifyContent: "center"}}>
          <LabelGrid labels={scene.labels} />
        </div>
      </div>
    </div>
  );
};
