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
  // Trim whitespace
  const trimmed = colorString.trim();

  // Match rgb(r, g, b) or rgba(r, g, b, a)
  const rgbaMatch = trimmed.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/,
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

// Parse font weight strings
const parseFontWeight = (value: string): number | string => {
  const weightMap: Record<string, number> = {
    thin: 100,
    "extra-light": 200,
    "ultra-light": 200,
    light: 300,
    regular: 400,
    normal: 400,
    medium: 500,
    "semi-bold": 600,
    "demi-bold": 600,
    bold: 700,
    "extra-bold": 800,
    "ultra-bold": 800,
    black: 900,
    heavy: 900,
  };

  return weightMap[value.toLowerCase()] || value;
};

// Convert a single token based on its schema type
const convertToken = (
  tokenName: string,
  tokenData: any,
  allowPrivate = false,
): any | null => {
  // Skip private tokens unless explicitly allowed
  if (tokenData.private && !allowPrivate) {
    return null;
  }

  // Skip deprecated tokens
  if (tokenData.deprecated) {
    return null;
  }

  const value = tokenData.value;
  const schema = tokenData.$schema || "";

  // Color set tokens (theme-specific colors) - use light theme
  if (schema.includes("color-set.json") && tokenData.sets?.light?.value) {
    const lightValue = tokenData.sets.light.value;
    if (typeof lightValue === "string") {
      const colorValue = parseColor(lightValue);
      if (colorValue) {
        return {
          $value: colorValue,
          $description: `Spectrum ${tokenName} (light theme)`,
        };
      }
    }
  }

  // Color tokens
  if (schema.includes("color.json") && typeof value === "string") {
    const colorValue = parseColor(value);
    if (colorValue) {
      return {
        $value: colorValue,
        $description: `Spectrum ${tokenName}`,
      };
    }
  }

  // Dimension tokens (px, rem, em)
  if (schema.includes("dimension.json") && typeof value === "string") {
    const dimValue = parseDimension(value);
    if (dimValue) {
      return {
        $value: dimValue,
        $description: `Spectrum ${tokenName}`,
      };
    }
  }

  // Font family tokens
  if (schema.includes("font-family.json") && typeof value === "string") {
    return {
      $value: value,
      $description: `Spectrum ${tokenName}`,
    };
  }

  // Font weight tokens
  if (schema.includes("font-weight.json")) {
    return {
      $value: parseFontWeight(String(value)),
      $description: `Spectrum ${tokenName}`,
    };
  }

  // Opacity tokens (numbers 0-1)
  if (schema.includes("opacity.json") && value !== undefined) {
    const numValue = typeof value === "string" ? parseFloat(value) : value;
    if (!isNaN(numValue)) {
      return {
        $value: numValue,
        $description: `Spectrum ${tokenName}`,
      };
    }
  }

  // Multiplier tokens (numbers for line-height, etc)
  if (schema.includes("multiplier.json") && value !== undefined) {
    const numValue = typeof value === "string" ? parseFloat(value) : value;
    if (!isNaN(numValue)) {
      return {
        $value: numValue,
        $description: `Spectrum ${tokenName}`,
      };
    }
  }

  // Scale set tokens (desktop/mobile variants) - use desktop
  if (schema.includes("scale-set.json") && tokenData.sets?.desktop?.value) {
    const desktopValue = tokenData.sets.desktop.value;
    if (typeof desktopValue === "string") {
      const dimValue = parseDimension(desktopValue);
      if (dimValue) {
        return {
          $value: dimValue,
          $description: `Spectrum ${tokenName} (desktop scale)`,
        };
      }
    }
  }

  return null;
};

// Extract subgroup and token name from a token name
const parseTokenName = (
  tokenName: string,
): { group: string | null; name: string } => {
  // Convert to camelCase first
  const camelName = tokenName.replace(/-([a-z0-9])/g, (g) =>
    g[1].toUpperCase(),
  );

  // Common patterns for grouping:
  // gray100 -> group: gray, name: 100
  // transparentWhite25 -> group: transparentWhite, name: 25
  // cornerRadius75 -> group: cornerRadius, name: 75
  // workflowIconSize100 -> group: workflowIconSize, name: 100

  // Match pattern: [prefix][number]
  const match = camelName.match(/^([a-z][a-zA-Z]*?)(\d+)$/);
  if (match) {
    return { group: match[1], name: match[2] };
  }

  // For tokens that don't match the pattern (like "white", "black"), no group
  return { group: null, name: camelName };
};

// Process a source file and convert its tokens
const processSourceFile = async (
  fileName: string,
  categoryName: string,
  categoryType: string,
  categoryDescription: string,
  allowPrivate = false,
): Promise<{ category: any; count: number }> => {
  const filePath = resolve(
    __dirname,
    `../node_modules/@adobe/spectrum-tokens/src/${fileName}`,
  );

  const content = await readFile(filePath, "utf-8");
  const sourceTokens = JSON.parse(content);

  const category: any = {
    $type: categoryType,
    $description: categoryDescription,
  };

  let count = 0;

  for (const [tokenName, tokenData] of Object.entries(sourceTokens)) {
    const converted = convertToken(tokenName, tokenData, allowPrivate);
    if (converted) {
      const { group, name } = parseTokenName(tokenName);

      if (group) {
        // Create subgroup if it doesn't exist
        if (!category[group]) {
          category[group] = {
            $type: categoryType,
          };
        }
        category[group][name] = converted;
      } else {
        // No group, add directly to category
        category[name] = converted;
      }
      count++;
    }
  }

  return { category, count };
};

const convertSpectrumTokens = async () => {
  console.log("🎨 Converting Spectrum tokens to engramma format...\n");

  const engrammaTokens: Record<string, any> = {};
  const stats: Record<string, number> = {};

  // Define source files and their corresponding categories
  const sources = [
    {
      file: "color-palette.json",
      name: "colorPalette",
      type: "color",
      description: "Spectrum base color palette with numeric scales",
      allowPrivate: true, // Include private tokens for base palette
    },
    {
      file: "color-aliases.json",
      name: "colorAliases",
      type: "color",
      description: "Color aliases and opacity values for design purposes",
      allowPrivate: false,
    },
    {
      file: "color-component.json",
      name: "colorComponent",
      type: "color",
      description: "Component-specific color tokens",
      allowPrivate: false,
    },
    {
      file: "typography.json",
      name: "typography",
      type: "fontFamily",
      description:
        "Typography tokens including fonts, weights, line-heights, and text styles",
      allowPrivate: false,
    },
    {
      file: "layout.json",
      name: "layout",
      type: "dimension",
      description: "Layout tokens including spacing, corner radius, and sizing",
      allowPrivate: false,
    },
    {
      file: "layout-component.json",
      name: "layoutComponent",
      type: "dimension",
      description: "Component-specific layout and sizing tokens",
      allowPrivate: false,
    },
    {
      file: "icons.json",
      name: "icons",
      type: "dimension",
      description: "Icon size and color tokens",
      allowPrivate: false,
    },
  ];

  // Process each source file
  for (const source of sources) {
    try {
      const { category, count } = await processSourceFile(
        source.file,
        source.name,
        source.type,
        source.description,
        source.allowPrivate,
      );

      // Only add category if it has tokens beyond metadata
      if (Object.keys(category).length > 2) {
        engrammaTokens[source.name] = category;
        stats[source.name] = count;
        console.log(`✓ ${source.name}: ${count} tokens`);
      }
    } catch (error) {
      console.log(`✗ ${source.name}: Error processing file`);
    }
  }

  // Write to file
  const outputPath = resolve(
    process.cwd(),
    "src",
    "design-tokens-example.tokens.json",
  );
  await writeFile(outputPath, JSON.stringify(engrammaTokens, null, 2));

  console.log("\n✅ Conversion complete!");
  console.log(`📊 Total categories: ${Object.keys(engrammaTokens).length}`);
  console.log(
    `📊 Total tokens: ${Object.values(stats).reduce((a, b) => a + b, 0)}`,
  );
  console.log(`\n📁 Output: ${outputPath}`);
};

convertSpectrumTokens().catch((error) => {
  console.error("❌ Error converting tokens:", error);
  process.exit(1);
});
