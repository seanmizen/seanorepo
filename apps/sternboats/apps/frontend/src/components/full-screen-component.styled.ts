import styled from "styled-components";

export const FullScreenComponent = styled("div")({
  position: "relative", // <-- this is essential
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  width: "100vw",
});
