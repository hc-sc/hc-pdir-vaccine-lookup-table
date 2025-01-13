# PDIR Lookup Table Automation
[![Daily Fetch](https://github.com/raviraj-mangukiya/pdir-lookup-table-automation/actions/workflows/daily-fetch.yml/badge.svg)](https://github.com/raviraj-mangukiya/pdir-lookup-table-automation/actions/workflows/daily-fetch.yml)
## Overview

`pdir-lookup-table-automation` is a Node.js-based project designed to automate the process of interacting with and managing the PDIR (Pan-Canadian Digital Immunization records) Lookup Table. The project leverages TypeScript to define the logic and uses Node.js to run and manage the automation tasks.

## Features

- Automates the lookup table processes for PDIR.
- Implements a simple, scalable structure to integrate with existing systems.
- Can be extended to support other related functionalities.

## Installation

To get started with this project, clone the repository and install the dependencies using npm:

```bash
git clone git@github.com:raviraj-mangukiya/pdir-lookup-table-automation.git
cd pdir-lookup-table-automation
npm install
```

## Usage

Once installed, you can run the automation script to fetch the required data using the following command:

```bash
npm run fetch
```

This command will run the `app.ts` file via `ts-node`, which is specified in the `scripts` section of the `package.json` file.

## Scripts

- **`fetch`**: Executes the TypeScript file `app.ts` using `ts-node` to fetch the required data and perform the lookup table automation.

## File Structure

- **`app.ts`**: Contains the main logic for the lookup table automation.
- **`package.json`**: Defines the project metadata, dependencies, and scripts.

## Dependencies

This project uses the following dependencies:

- `ts-node`: Executes TypeScript code without the need to compile it manually.

## Contributing

We welcome contributions to improve the functionality and extend the capabilities of the `pdir-lookup-table-automation` project. Please fork the repository, make your changes, and submit a pull request.