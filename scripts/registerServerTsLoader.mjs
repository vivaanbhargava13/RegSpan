import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./scripts/serverTsLoader.mjs", pathToFileURL("./"));
