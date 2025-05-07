import 'dotenv/config';
import fs from "fs/promises";
import axios from "axios";
import path from "path";

const API_URL = process.env.NVC_API_URL || "https://nvc-cnv.canada.ca";

const config = {
  method: "get",
  maxBodyLength: Infinity,
  url: API_URL + "/v1/Bundle/NVC",
  headers: {
    Accept: "application/json+fhir",
    "x-app-desc": "PHAC-PDIR-IIB",
  },
  timeout: 30000,  // 30 second timeout
  maxRedirects: 5,
  validateStatus: (status: number) => status >= 200 && status < 300
};

interface Concept {
  code: string;
  display: string;
  designation: {
    language: string;
    use?: {
      system: string;
      code: string;
      display: string;
    };
    value: string;
  }[];
  extension: Extension[];
}

interface ValueCodeableConcept {
  coding: Coding[];
  text: string;
}

interface Extension {
  url: string;
  extension?: Extension[];
  valueCodeableConcept?: ValueCodeableConcept;
}

interface ValueSet {
  id: string;
  meta: {
    versionId: string;
    lastUpdated: string;
  };
  url: string;
  status: string;
  date: string;
  compose: {
    include: {
      system: string;
      version: string;
      concept: Concept[];
    }[];
  };
  resourceType: "ValueSet";
}

interface Data {
  id: string;
  meta: {
    versionId: string;
    lastUpdated: string;
  };
  type: string;
  entry: {
    fullUrl: string;
    resource: ValueSet;
  }[];
  resourceType: "Bundle" | "Collection";
}

interface CurrentVersion {
    versionId: string;
  }

// Helper to check if the resource is a part of Generics, Tradenames, or AntigenIgAntitoxin
function isValueSet(id: string): boolean {
  return ["Generic", "Tradename", "AntigenIgAntitoxin"].includes(id);
}

function isValueSetDisease(id: string): boolean {
  return ["Disease"].includes(id);
}

function isValueSetMAH(id: string): boolean {
  return ["MarketAuthorizationHolder"].includes(id);
}

interface Coding {
  system: string;
  code: string;
  display: string;
}

function getExtensionValueByUrl(
  concept: Concept,
  targetUrl: string
): { [code: string]: string }[] {
  const valObject: { [code: string]: string } = {};
  const findExtensions = (extensions: Extension[]): Extension[] => {
    let result: Extension[] = [];

    extensions.forEach((extension) => {
      if (extension.url && extension.url.trim().toLowerCase() === targetUrl.trim().toLowerCase()) {
        result.push(extension);
      }

      if (extension.extension && Array.isArray(extension.extension)) {
        result = result.concat(findExtensions(extension.extension));
      }
    });

    return result;
  };
  
  const extensions = findExtensions(concept.extension);

  extensions.forEach((ext) => {
    const coding = ext.valueCodeableConcept?.coding;
    if (coding) {
      coding.forEach((c) => {
        valObject[c.code] = c.display;
      });
    }
  });

  return Object.keys(valObject).length > 0 ? [valObject] : [];
}

// Helper functions to get display names
function getDisplayName(concept: Concept, lang: string, code: string): string | undefined {
  return concept.designation?.find(
    d => d.language === lang && d.use?.code === code && d.use?.system === "https://nvc-cnv.canada.ca/v1/NamingSystem/nvc-display-terms-designation"
  )?.value;
}

function parseNVCBundle(data: Data, diseaseLookup: Record<string, { en: string, fr: string }>, mahLookup: Record<string, { en: string, fr: string }>) {
  const table: Record<string, any> = {};

  data.entry.forEach((entry) => {
    const resource = entry.resource;
    if (isValueSet(resource.id)) {
      if (resource.compose && Array.isArray(resource.compose.include)) {
        resource.compose.include.forEach((include) => {
          if (include.concept && Array.isArray(include.concept)) {
            include.concept.forEach((concept) => {
              const displayEN = getDisplayName(concept, 'en', 'enDisplayTerm') || concept.display;
              const displayFR = getDisplayName(concept, 'fr', 'frDisplayTerm') || concept.display;
              const disease = getExtensionValueByUrl(
                concept,
                `${API_URL}/v1/StructureDefinition/nvc-protects-against-disease`
              );
              const MAH = getExtensionValueByUrl(
                concept,
                `${API_URL}/v1/StructureDefinition/nvc-linked-to-market-authorization-holder`
              );

              // Get disease names in both languages
              let diseaseEN: { [code: string]: string }[] = [];
              let diseaseFR: { [code: string]: string }[] = [];
              if (disease && disease.length > 0) {
                const codes = Object.keys(disease[0]);
                diseaseEN = codes.map(code => ({ [code]: diseaseLookup[code]?.en || code }));
                diseaseFR = codes.map(code => ({ [code]: diseaseLookup[code]?.fr || code }));
              }

              // Get MAH names in both languages
              let MAHEN = "";
              let MAHFR = "";
              if (MAH && MAH.length > 0) {
                const codes = Object.keys(MAH[0]);
                if (codes.length > 0) {
                  MAHEN = mahLookup[codes[0]]?.en || MAH[0][codes[0]];
                  MAHFR = mahLookup[codes[0]]?.fr || MAH[0][codes[0]];
                }
              }

              // Create table entry with only the required fields
              table[concept.code] = {
                displayEN,
                displayFR,
                diseaseEN,
                diseaseFR
              };

              // Add MAH if present
              if (MAHEN && MAHFR) {
                table[concept.code].MAHEN = MAHEN;
                table[concept.code].MAHFR = MAHFR;
              }
            });
          }
        });
      }
    }
  });

  return table;
}

// Main function to handle the entire process
const main = async () => {
  try {
    const response = await axios.request<Data>(config);

    // Log all resource IDs we receive
    console.log("Received resource IDs:", response.data.entry.map(entry => entry.resource.id));

    // 1. Write disease.json if Disease resource is present
    let diseaseResource: ValueSet | undefined;
    let mahResource: ValueSet | undefined;
    response.data.entry.forEach((entry) => {
      if (isValueSetDisease(entry.resource.id)) {
        diseaseResource = entry.resource as ValueSet;
      }
      if (isValueSetMAH(entry.resource.id)) {
        mahResource = entry.resource as ValueSet;
      }
    });

    // Write disease.json
    if (diseaseResource) {
      await fs.writeFile(
        path.join(__dirname, "vaccine-table/disease.json"),
        JSON.stringify(diseaseResource.compose, null, 2),
        "utf8"
      );
    }

    // Write mah.json
    if (mahResource) {
      await fs.writeFile(
        path.join(__dirname, "vaccine-table/mah.json"),
        JSON.stringify(mahResource.compose, null, 2),
        "utf8"
      );
    }

    // 2. Build disease lookup
    const diseaseData = JSON.parse(
      await fs.readFile(path.join(__dirname, "vaccine-table/disease.json"), "utf8")
    );
    const diseaseLookup: Record<string, { en: string; fr: string }> = {};
    diseaseData.include.forEach((include: any) => {
      include.concept.forEach((concept: any) => {
        const en = concept.designation?.find(
          (d: any) => 
            d.language === "en" && 
            d.use?.system === "https://nvc-cnv.canada.ca/v1/NamingSystem/nvc-display-terms-designation" &&
            d.use?.code === "enDisplayTerm"
        )?.value || concept.display;
        
        const fr = concept.designation?.find(
          (d: any) => 
            d.language === "fr" && 
            d.use?.system === "https://nvc-cnv.canada.ca/v1/NamingSystem/nvc-display-terms-designation" &&
            d.use?.code === "frDisplayTerm"
        )?.value || concept.display;
        
        diseaseLookup[concept.code] = { en, fr };
      });
    });

    // Build MAH lookup
    let mahLookup: Record<string, { en: string; fr: string }> = {};
    if (mahResource) {
      try {
        const mahData = JSON.parse(
          await fs.readFile(path.join(__dirname, "vaccine-table/mah.json"), "utf8")
        );
        mahData.include.forEach((include: any) => {
          include.concept.forEach((concept: any) => {
            const en = concept.designation?.find(
              (d: any) => 
                d.language === "en" && 
                d.use?.system === "https://nvc-cnv.canada.ca/v1/NamingSystem/nvc-display-terms-designation" &&
                d.use?.code === "enDisplayTerm"
            )?.value || concept.display;
            
            const fr = concept.designation?.find(
              (d: any) => 
                d.language === "fr" && 
                d.use?.system === "https://nvc-cnv.canada.ca/v1/NamingSystem/nvc-display-terms-designation" &&
                d.use?.code === "frDisplayTerm"
            )?.value || concept.display;
            
            mahLookup[concept.code] = { en, fr };
          });
        });
      } catch (error) {
        console.error("Error reading MAH data:", error);
        mahLookup = {}; // Use empty lookup if file can't be read
      }
    }

    // 3. Parse vaccines and write nvc-bundle.json
    const result = {
      version: response.data.meta.versionId,
      table: parseNVCBundle(response.data, diseaseLookup, mahLookup),
    };
    await fs.writeFile(
      path.join(__dirname, "vaccine-table/nvc-bundle.json"),
      JSON.stringify(result, null, 2),
      "utf8"
    );

    // Write version file
    const versionFilePath = path.join(__dirname, "nvc-version.json");
    await fs.writeFile(
      versionFilePath,
      JSON.stringify({ versionId: response.data.meta.versionId }),
      "utf8"
    );
    console.info("Successfully updated! current version is: " + response.data.meta.versionId);

  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`)
    } else {
      console.error("Error: Unknown error");
    }
  }
};

// Execute the main function
(async () => {
  await main();
})().catch((error) => {
  console.error(`Unhandled error: ${error instanceof Error ? error.message : "Unknown error"}`)
});
