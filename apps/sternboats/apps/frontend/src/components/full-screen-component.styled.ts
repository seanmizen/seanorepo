import styled from "styled-components";

export const FullScreenComponent = styled("div")({
  position: "relative", // <-- this is essential
  // overflow: "hidden", // important
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  width: "100vw",
});
