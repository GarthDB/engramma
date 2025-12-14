import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Utility to parse RGB/RGBA strings from Spectrum tokens
const parseColor = (
  colorString: string,
): {
  colorSpace: "srgb";
  components: [number, number, number];
  alpha?: number;
} | null => {
  // Match rgb(r, g, b) or rgba(r, g, b, a)
  const rgbaMatch = colorString.match(
    /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/,
  );
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1]) / 255;
    const g = parseInt(rgbaMatch[2]) / 255;
    const b = parseInt(rgbaMatch[3]) / 255;
    const alpha = rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : undefined;

    const result: {
      colorSpace: "srgb";
      components: [number, number, number];
      alpha?: number;
    } = {
      colorSpace: "srgb",
      components: [r, g, b],
    };

    if (alpha !== undefined && alpha !== 1) {
      result.alpha = alpha;
    }

    return result;
  }

  return null;
};

// Determine token type based on name and value
const inferTokenType = (
  name: string,
  value: string | number,
): string | null => {
  // Color patterns
  if (
    name.includes("color") ||
    name.includes("background") ||
    name.includes("border-color")
  ) {
    if (typeof value === "string" && value.startsWith("rgb")) {
      return "color";
    }
  }

  // Dimension patterns
  if (
    name.includes("size") ||
    name.includes("width") ||
    name.includes("height") ||
    name.includes("spacing") ||
    name.includes("gap") ||
    name.includes("padding") ||
    name.includes("margin")
  ) {
    if (typeof value === "string" && /\d+(px|rem|em)/.test(value)) {
      return "dimension";
    }
  }

  // Duration patterns
  if (name.includes("duration") || name.includes("delay")) {
    if (typeof value === "string" && /\d+(ms|s)/.test(value)) {
      return "duration";
    }
  }

  // Number patterns (opacity, weights, multipliers)
  if (
    name.includes("opacity") ||
    name.includes("weight") ||
    name.includes("multiplier") ||
    name.includes("ratio")
  ) {
    if (typeof value === "string" && /^[\d.]+$/.test(value)) {
      return "number";
    }
  }

  return null;
};

// Parse dimension value
const parseDimension = (
  value: string,
): {
  value: number;
  unit: "px" | "rem";
} | null => {
  const match = value.match(/^([\d.]+)(px|rem|em)$/);
  if (match) {
    const numValue = parseFloat(match[1]);
    let unit: "px" | "rem" = "px";
    if (match[2] === "rem" || match[2] === "em") {
      unit = "rem";
    }
    return { value: numValue, unit };
  }
  return null;
};

// Parse duration value
const parseDuration = (
  value: string,
): {
  value: number;
  unit: "ms" | "s";
} | null => {
  const match = value.match(/^([\d.]+)(ms|s)$/);
  if (match) {
    return {
      value: parseFloat(match[1]),
      unit: match[2] as "ms" | "s",
    };
  }
  return null;
};

const convertSpectrumTokens = async () => {
  console.log("🎨 Converting Spectrum tokens to engramma format...");

  // Read Spectrum tokens from the JSON file
  const tokensPath = resolve(
    __dirname,
    "../node_modules/@adobe/spectrum-tokens/dist/json/variables.json",
  );
  const tokensContent = await readFile(tokensPath, "utf-8");
  const spectrumTokens = JSON.parse(tokensContent);
  console.log(
    `📦 Loaded ${Object.keys(spectrumTokens).length} Spectrum tokens`,
  );

  // Organize tokens by type
  const engrammaTokens: Record<string, any> = {
    colors: {
      $type: "color",
      $description: "Spectrum color tokens",
    },
    dimensions: {
      $type: "dimension",
      $description: "Spectrum dimension tokens",
    },
    durations: {
      $type: "duration",
      $description: "Spectrum duration tokens",
    },
    numbers: {
      $type: "number",
      $description: "Spectrum numeric tokens",
    },
  };

  let stats = {
    colors: 0,
    dimensions: 0,
    durations: 0,
    numbers: 0,
    skipped: 0,
  };

  // Convert tokens
  for (const [tokenName, tokenData] of Object.entries(spectrumTokens)) {
    // Skip deprecated tokens
    if ((tokenData as any).deprecated) {
      stats.skipped++;
      continue;
    }

    // Get the value - prefer light theme if sets exist, otherwise use direct value
    let value: string | number | undefined;
    if ((tokenData as any).sets && (tokenData as any).sets.light) {
      value = (tokenData as any).sets.light.value;
    } else if ((tokenData as any).value) {
      value = (tokenData as any).value;
    }

    if (!value) {
      stats.skipped++;
      continue;
    }

    // Determine token type and convert
    const tokenType = inferTokenType(tokenName, value);

    if (tokenType === "color" && typeof value === "string") {
      const colorValue = parseColor(value);
      if (colorValue) {
        // Create a clean token name (replace hyphens with camelCase)
        const cleanName = tokenName.replace(/-([a-z])/g, (g) =>
          g[1].toUpperCase(),
        );
        engrammaTokens.colors[cleanName] = {
          $value: colorValue,
          $description: `Spectrum ${tokenName}`,
        };
        stats.colors++;
      } else {
        stats.skipped++;
      }
    } else if (tokenType === "dimension" && typeof value === "string") {
      const dimValue = parseDimension(value);
      if (dimValue) {
        const cleanName = tokenName.replace(/-([a-z])/g, (g) =>
          g[1].toUpperCase(),
        );
        engrammaTokens.dimensions[cleanName] = {
          $value: dimValue,
          $description: `Spectrum ${tokenName}`,
        };
        stats.dimensions++;
      } else {
        stats.skipped++;
      }
    } else if (tokenType === "duration" && typeof value === "string") {
      const durValue = parseDuration(value);
      if (durValue) {
        const cleanName = tokenName.replace(/-([a-z])/g, (g) =>
          g[1].toUpperCase(),
        );
        engrammaTokens.durations[cleanName] = {
          $value: durValue,
          $description: `Spectrum ${tokenName}`,
        };
        stats.durations++;
      } else {
        stats.skipped++;
      }
    } else if (tokenType === "number") {
      const numValue = typeof value === "string" ? parseFloat(value) : value;
      if (!isNaN(numValue)) {
        const cleanName = tokenName.replace(/-([a-z])/g, (g) =>
          g[1].toUpperCase(),
        );
        engrammaTokens.numbers[cleanName] = {
          $value: numValue,
          $description: `Spectrum ${tokenName}`,
        };
        stats.numbers++;
      } else {
        stats.skipped++;
      }
    } else {
      stats.skipped++;
    }
  }

  // Remove empty groups
  Object.keys(engrammaTokens).forEach((group) => {
    if (Object.keys(engrammaTokens[group]).length === 2) {
      // Only has $type and $description
      delete engrammaTokens[group];
    }
  });

  // Write to file
  const outputPath = resolve(
    process.cwd(),
    "src",
    "design-tokens-example.tokens.json",
  );
  await writeFile(outputPath, JSON.stringify(engrammaTokens, null, 2));

  console.log("\n✅ Conversion complete!");
  console.log(`📊 Statistics:`);
  console.log(`   - Colors: ${stats.colors}`);
  console.log(`   - Dimensions: ${stats.dimensions}`);
  console.log(`   - Durations: ${stats.durations}`);
  console.log(`   - Numbers: ${stats.numbers}`);
  console.log(`   - Skipped: ${stats.skipped}`);
  console.log(`\n📁 Output: ${outputPath}`);
};

convertSpectrumTokens().catch((error) => {
  console.error("❌ Error converting tokens:", error);
  process.exit(1);
});
