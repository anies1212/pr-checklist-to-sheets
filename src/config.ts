import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { Member } from "./types";

export function readMembersConfig(configPath: string): Member[] {
  const fullPath = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Members config not found at ${fullPath}`);
  }

  const content = fs.readFileSync(fullPath, "utf8");
  const ext = path.extname(fullPath).toLowerCase();
  let parsed: unknown;

  if (ext === ".yml" || ext === ".yaml") {
    parsed = yaml.load(content);
  } else {
    parsed = JSON.parse(content);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { members?: unknown }).members)
  ) {
    throw new Error("Config must be an object with a members array");
  }

  const members = (parsed as { members: Member[] }).members.filter((m) => !!m);

  if (!members.length) {
    throw new Error("Members list is empty");
  }

  members.forEach((member) => {
    if (!member.name) {
      throw new Error("Each member must have a name");
    }
  });

  return members;
}
