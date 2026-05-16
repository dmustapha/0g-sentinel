import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";

const ERC7857_INTERFACE_ID = "0x4f694152";

const ERC7857_ABI = [
  "function supportsInterface(bytes4 interfaceId) external view returns (bool)",
  "function dataHashesOf(uint256 tokenId) external view returns (bytes32[] memory)",
  "function dataDescriptionsOf(uint256 tokenId) external view returns (string[] memory)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
];

const RPC = process.env.ZERO_G_RPC || "https://evmrpc.0g.ai";

export async function POST(req: NextRequest) {
  let body: { contractAddress?: unknown; tokenId?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { contractAddress, tokenId = 1 } = body;
  if (!contractAddress || typeof contractAddress !== "string" || !contractAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
    return NextResponse.json({ error: "Invalid contractAddress" }, { status: 400 });
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const contract = new ethers.Contract(contractAddress, ERC7857_ABI, provider);

    let isERC7857 = false;
    try {
      isERC7857 = await contract.supportsInterface(ERC7857_INTERFACE_ID);
    } catch { /* contract may not implement ERC-165 */ }

    let dataHashes: string[] = [];
    let dataDescriptions: string[] = [];
    let owner: string | null = null;
    try {
      dataHashes = await contract.dataHashesOf(BigInt(tokenId as number));
      dataDescriptions = await contract.dataDescriptionsOf(BigInt(tokenId as number));
      isERC7857 = true;
    } catch { /* not an ERC-7857 contract */ }

    try {
      owner = await contract.ownerOf(BigInt(tokenId as number));
    } catch { /* optional */ }

    return NextResponse.json({
      contractAddress,
      tokenId: Number(tokenId),
      isERC7857,
      owner,
      dataHashes,
      dataDescriptions,
      network: "0G Aristotle Mainnet (16661)",
    });
  } catch (err: unknown) {
    console.error("[iNFT] Error:", err);
    return NextResponse.json({ error: "Contract query failed" }, { status: 500 });
  }
}
