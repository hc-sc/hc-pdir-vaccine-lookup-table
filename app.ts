import fs from "fs/promises";
import axios from "axios";
import path from "path";

const API_URL = "https://nvc-cnv.canada.ca";

const config = {
  method: "get",
  maxBodyLength: Infinity,
  url: API_URL + "/v1/Bundle/NVC",
  headers: {
    Accept: "application/json+fhir",
    "x-app-desc": "PHAC-PDIR-IIB",
  },
};

interface Concept {
  code: string;
  display: string;
  designation: {
    language: string;
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

function parseNVCBundle(data: Data) {
  const table: Record<string, any> = {};

  data.entry.forEach((entry) => {
    const resource = entry.resource;

    // Only process the specified value sets
    if (isValueSet(resource.id)) {
      // Check if 'compose' and 'include' are defined before accessing them
      if (resource.compose && Array.isArray(resource.compose.include)) {
        resource.compose.include.forEach((include) => {
          if (include.concept && Array.isArray(include.concept)) {
            include.concept.forEach((concept) => {
              const displayName = concept.display;
              const disease = getExtensionValueByUrl(concept, "https://nvc-cnv.canada.ca/v1/StructureDefinition/nvc-protects-against-disease");
              const MAH = getExtensionValueByUrl(concept, "https://nvc-cnv.canada.ca/v1/StructureDefinition/nvc-linked-to-market-authorization-holder");

              table[concept.code] = {
                displayName
              };
              if (Object.keys(disease).length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                table[concept.code].disease = disease;
              }
              if (Object.keys(MAH).length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                table[concept.code].MAH = MAH;
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
  
    const newVersionId = response.data.meta.versionId;
    // Define the path to the file that stores the current versionId
    const versionFilePath = path.join(__dirname, "nvc-version.json");

    let currentVersionId: string | null = null;
    try {
      const currentVersionData = await fs.readFile(versionFilePath, "utf8");
      const currentVersion: CurrentVersion = JSON.parse(
        currentVersionData
      ) as CurrentVersion;
      currentVersionId = currentVersion.versionId;
    } catch (err) {
      console.info("No previous version found, will write new data.");
    }
    // Check if the versionId has been updated
    if (currentVersionId !== newVersionId) {
        const result = {
            version: newVersionId,
            table: parseNVCBundle(response.data),
          };
        await fs.writeFile(path.join(__dirname, "vaccine-table/nvc-bundle.json"),
          JSON.stringify(result, null, 2),
          "utf8"
        );

        await fs.writeFile(
            versionFilePath,
            JSON.stringify({ versionId: newVersionId }),
            "utf8"
          );
        console.info("Succeessfully updated! current version is: " + newVersionId );
    }
    else{
        console.info("No change! current version is: " + currentVersionId );
    }

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
  await main(); // Await the main function
})().catch((error) => {
    console.error(`Unhandled error: ${error instanceof Error ? error.message : "Unknown error"}`)
});
