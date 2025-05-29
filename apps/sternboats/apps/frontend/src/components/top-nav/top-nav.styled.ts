import styled from "styled-components";

// @media (prefers-color-scheme: light) {
//       --link-color: #c6c9ff;  /* Soft blue for links */
//       --link-hover-color: #9497e8;  /* Slightly darker blue for link hover */

export const StyledNav = styled("nav")({
  position: "absolute",
  top: 0,
  left: 0,
  width: "100vw",
  display: "flex",
  justifyContent: "center",
  zIndex: 2,
  padding: "1rem 0",
  textShadow: "0 1px 2px rgba(0, 0, 0, 0.7), 0 2px 6px rgba(0, 0, 0, 0.3)",

  "& a": {
    color: "#c6c9ff",
  },

  pointerEvents: "auto",

  "& > .container": {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "2rem",
    maxWidth: "1000px",
    width: "100%",
    padding: "0 2rem",
  },

  "& .left, & .right": {
    display: "flex",
    alignItems: "center",
    gap: "1.5rem",
  },
});
