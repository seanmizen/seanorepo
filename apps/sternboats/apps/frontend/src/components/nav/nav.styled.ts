import styled from "styled-components";

export const StyledNav = styled("nav")({
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: "1rem",
  padding: "1rem 0.8rem",
  backgroundColor: "var(--nav-background-color)",
  position: "sticky",
  top: 0,
});
