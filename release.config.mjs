export default {
  branches: ["main"],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/npm",
      {
        npmPublish: false,
      },
    ],
    [
      "@semantic-release/exec",
      {
        prepareCmd: "pnpm run build && pnpm run package",
      },
    ],
    [
      "@semantic-release/git",
      {
        assets: ["package.json"],
        message:
          "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
      },
    ],
    [
      "@semantic-release/github",
      {
        assets: [
          {
            path: "PowerShift.zip",
            label: "PowerShift.zip",
          },
        ],
      },
    ],
  ],
};
