# Toolchain preview archives

The workspace uses these Vite, Vitest and React Router development builds. Upstream preview links expire. Committing the original archives keeps clean installs, Docker and CI reproducible. The Vite and Vitest archives contain their upstream licenses. React Router’s repository license accompanies its archive. pnpm verifies the archive integrity recorded in the lockfile.

| Package                | Upstream preview                                                                                                              | Git commit                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `vite`                 | [Original archive](https://pkg.pr.new/vitejs/vite/vite@7d0c054f41ba1107a1d7d9ddae23930d9d6b4f8e)                              | [`7d0c054f4`](https://github.com/vitejs/vite/commit/7d0c054f41ba1107a1d7d9ddae23930d9d6b4f8e)              |
| `vitest`               | [Original archive](https://pkg.pr.new/vitest-dev/vitest/vitest@c08e4db58db1bfbcdb2f9a46a33ba02b3ea158ad)                      | [`c08e4db58`](https://github.com/vitest-dev/vitest/commit/c08e4db58db1bfbcdb2f9a46a33ba02b3ea158ad)        |
| `@vitejs/plugin-react` | [Original archive](https://pkg.pr.new/vitejs/vite-plugin-react/@vitejs/plugin-react@80cbf1da20ac6d70709faa70268073d0cc67ceca) | [`80cbf1da2`](https://github.com/vitejs/vite-plugin-react/commit/80cbf1da20ac6d70709faa70268073d0cc67ceca) |
| `@vitest/mocker`       | [Original archive](https://pkg.pr.new/vitest-dev/vitest/@vitest/mocker@c08e4db58db1bfbcdb2f9a46a33ba02b3ea158ad)              | [`c08e4db58`](https://github.com/vitest-dev/vitest/commit/c08e4db58db1bfbcdb2f9a46a33ba02b3ea158ad)        |
| `@vitest/spy`          | [Original archive](https://pkg.pr.new/vitest-dev/vitest/@vitest/spy@c08e4db58db1bfbcdb2f9a46a33ba02b3ea158ad)                 | [`c08e4db58`](https://github.com/vitest-dev/vitest/commit/c08e4db58db1bfbcdb2f9a46a33ba02b3ea158ad)        |

React Router is packed from the prebuilt `packages/react-router` directory in the official [installable preview branch snapshot](https://github.com/remix-run/react-router/commit/12057c9fd953ffcb6ddbde4f006c1aabad462b11) with `npm pack --ignore-scripts`.
