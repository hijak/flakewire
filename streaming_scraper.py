#!/usr/bin/env python3
"""
Clean Streaming Scraper with AllDebrid Integration
Manual link processing only - no automated site scraping
"""

import asyncio
import json
import time
import re
from typing import List, Dict, Optional
from urllib.parse import urljoin, urlparse
import requests


class StreamingScraper:
    def __init__(self, alldebrid_api_key: str = None):
        self.alldebrid_api_key = alldebrid_api_key
        self.alldebrid_base_url = "https://api.alldebrid.com/v4"

        # Manual processing only - no automated scraping
        self.processing_mode = "manual"
        self.supported_hosts = self.get_supported_hosts()

        print("🎯 Streaming Scraper - Manual Processing Mode")
        print("✅ AllDebrid integration ready")
        print("📝 Manual link input and file processing")

    def get_supported_hosts(self):
        """
        Return list of hosting providers supported by AllDebrid
        """
        supported_hosts = [
            "uploaded.net", "rapidgator.net", "nitroflare.com",
            "katfile.com", "uptobox.com", "1fichier.com",
            "filerio.com", "turbobit.net", "userupload.net",
            "ddownload.com", "dropapk.to", "k2s.cc",
            "keep2share.cc", "filefactory.com", "oboom.com",
            "rapidrar.com", "file-up.org", "uploadgig.com"
        ]

        return supported_hosts

    def extract_links_from_text(self, text: str) -> List[str]:
        """
        Extract download links from text content
        """
        url_pattern = r'https?://[^\s<>"\'(){}[\]]+(?:\/[^\s<>"\'(){}[\]]*)?'
        urls = re.findall(url_pattern, text)

        # Filter for known hosting providers
        valid_links = []
        for url in urls:
            try:
                hostname = urlparse(url).hostname.lower()
                if any(host in hostname for host in self.supported_hosts):
                    valid_links.append(url)
            except:
                continue

        return list(set(valid_links))  # Remove duplicates

    def validate_link(self, link: str) -> Dict:
        """
        Validate and analyze a download link
        """
        try:
            parsed = urlparse(link)
            hostname = parsed.hostname.lower()

            info = {
                "url": link,
                "host": hostname,
                "valid": True,
                "supported": False,
                "host_type": "unknown"
            }

            # Check if host is supported by AllDebrid
            if any(host in hostname for host in self.supported_hosts):
                info["supported"] = True
                info["host_type"] = hostname

            return info

        except Exception as e:
            return {
                "url": link,
                "host": "invalid",
                "valid": False,
                "supported": False,
                "error": str(e)
            }

    def unlock_with_alldebrid(self, link: str) -> Optional[Dict]:
        """
        Unlock a download link using AllDebrid API
        """
        if not self.alldebrid_api_key:
            return {
                "success": False,
                "error": "No AllDebrid API key provided",
                "original_link": link
            }

        try:
            url = f"{self.alldebrid_base_url}/link/unlock"
            params = {
                'apikey': self.alldebrid_api_key,
                'link': link
            }

            response = requests.post(url, data=params, timeout=30)
            data = response.json()

            if data.get('status') == 'success':
                return {
                    "success": True,
                    "data": data.get('data'),
                    "original_link": link
                }
            else:
                return {
                    "success": False,
                    "error": data.get('error', 'Unknown error'),
                    "original_link": link
                }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "original_link": link
            }

    def process_links_batch(self, links: List[str]) -> List[Dict]:
        """
        Process a batch of links with validation and AllDebrid
        """
        results = []

        print(f"🔄 Processing {len(links)} links...")

        for i, link in enumerate(links, 1):
            print(f"📎 [{i}/{len(links)}] {urlparse(link).hostname}")

            # Validate link first
            validation = self.validate_link(link)
            if not validation["valid"]:
                results.append({
                    "success": False,
                    "error": "Invalid link format",
                    "original_link": link
                })
                continue

            # Try to unlock with AllDebrid
            if validation["supported"] and self.alldebrid_api_key:
                unlock_result = self.unlock_with_alldebrid(link)
                results.append(unlock_result)

                # Show result
                if unlock_result.get("success"):
                    data = unlock_result.get("data", {})
                    filename = data.get('filename', 'Unknown')
                    size = data.get('size', 0)
                    size_mb = size / (1024 * 1024) if size else 0
                    print(f"   ✅ {filename} ({size_mb:.1f} MB)")
                else:
                    error = unlock_result.get("error", "Unknown error")
                    print(f"   ❌ {error}")
            else:
                # No API key or unsupported host
                note = "No AllDebrid API key" if not self.alldebrid_api_key else "Unsupported host"
                results.append({
                    "success": False,
                    "error": note,
                    "original_link": link,
                    "host": validation["host"]
                })
                print(f"   ⚠️  {note}")

            # Rate limiting
            if i < len(links):  # Don't delay after last link
                time.sleep(1)

        return results

    def manual_link_input_mode(self):
        """
        Interactive mode for manual link input
        """
        print("\n" + "="*60)
        print("📝 MANUAL LINK INPUT MODE")
        print("="*60)
        print("Paste download links one by one.")
        print("Type 'done' when finished or 'quit' to exit.")
        print(f"\n🔗 Supported hosts: {len(self.supported_hosts)} providers")
        print("Examples: uploaded.net, rapidgator.net, nitroflare.com, etc.")

        links = []
        while True:
            try:
                prompt = f"\n📎 Link #{len(links)+1} (or 'done'): "
                if len(links) == 0:
                    prompt = f"\n📎 Enter first link (or 'done'): "

                link = input(prompt).strip()

                if link.lower() in ['done', 'exit', 'quit']:
                    break
                elif link:
                    # Quick validation
                    validation = self.validate_link(link)
                    if validation["valid"]:
                        if validation["supported"]:
                            print(f"   ✅ Added: {validation['host']}")
                        else:
                            print(f"   ⚠️  Added: {validation['host']} (unsupported)")
                        links.append(link)
                    else:
                        print(f"   ❌ Invalid link format")
                else:
                    print("   Please enter a valid link or 'done'")

            except KeyboardInterrupt:
                print("\n\n🛑 Input cancelled by user")
                break

        if links:
            print(f"\n🚀 Processing {len(links)} links...")
            results = self.process_links_batch(links)
            self.display_results(results)
            self.save_results(results, "manual_processing")
        else:
            print("\n📋 No links provided.")

    def process_links_from_file(self, filename: str):
        """
        Process links from a text file
        """
        try:
            with open(filename, 'r', encoding='utf-8') as f:
                content = f.read()

            print(f"📁 Reading links from: {filename}")
            links = self.extract_links_from_text(content)

            if not links:
                print("❌ No valid download links found in file.")
                return

            print(f"✅ Found {len(links)} valid links")
            results = self.process_links_batch(links)
            self.display_results(results)
            self.save_results(results, f"{filename.rsplit('.', 1)[0]}_processed")

        except FileNotFoundError:
            print(f"❌ File '{filename}' not found.")
        except Exception as e:
            print(f"❌ Error processing file: {str(e)}")

    def display_results(self, results: List[Dict]):
        """
        Display processing results
        """
        print("\n" + "="*60)
        print("📊 PROCESSING RESULTS")
        print("="*60)

        successful = 0
        failed = 0

        for result in results:
            if result.get("success"):
                successful += 1
                data = result.get("data", {})
                filename = data.get('filename', 'Unknown file')
                size = data.get('size', 0)
                size_mb = size / (1024 * 1024) if size else 0

                print(f"✅ SUCCESS: {filename}")
                print(f"   📏 Size: {size_mb:.1f} MB")
                print(f"   🔗 Download: {data.get('link', 'No direct link')[:60]}...")
                print()
            else:
                failed += 1
                error = result.get("error", "Unknown error")
                original = result.get("original_link", "Unknown")
                host = urlparse(original).hostname if original != "Unknown" else "Unknown"
                print(f"❌ FAILED: {host}")
                print(f"   💬 Error: {error}")
                print()

        print("-" * 60)
        print(f"📈 Summary: {successful} successful, {failed} failed")
        print(f"📊 Success Rate: {(successful/(successful+failed)*100):.1f}%" if (successful+failed) > 0 else "📊 Success Rate: 0%")

    def save_results(self, results: List[Dict], base_filename: str):
        """
        Save results to JSON file
        """
        filename = f"{base_filename}_results.json"
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(results, f, indent=2, ensure_ascii=False)
            print(f"💾 Results saved to: {filename}")
        except Exception as e:
            print(f"❌ Error saving results: {str(e)}")

    def test_alldebrid_connection(self):
        """
        Test AllDebrid API connection
        """
        print("\n🔧 Testing AllDebrid connection...")

        if not self.alldebrid_api_key:
            print("❌ No AllDebrid API key configured")
            return False

        # Test with a dummy link (will fail but tests the API)
        test_result = self.unlock_with_alldebrid("https://uploaded.net/file/test123")

        if test_result.get("success"):
            print("✅ AllDebrid connection successful!")
            return True
        else:
            error = test_result.get("error", "Unknown error")
            if "API key" in error.lower():
                print(f"❌ API key issue: {error}")
            elif "link" in error.lower():
                print("✅ AllDebrid connection successful! (Test link failed as expected)")
                return True
            else:
                print(f"⚠️  Connection issue: {error}")
            return False

    def show_status(self):
        """
        Display current scraper status
        """
        print("\n" + "="*60)
        print("📋 STREAMING SCRAPER STATUS")
        print("="*60)

        print(f"🔧 Processing Mode: 🟢 Manual Only")
        print(f"🔑 AllDebrid API: {'🟢 Configured' if self.alldebrid_api_key else '🔴 Not Configured'}")
        print(f"🌐 Supported Hosts: 🟢 {len(self.supported_hosts)} providers")

        if self.alldebrid_api_key:
            print(f"📍 API Endpoint: {self.alldebrid_base_url}")

        print(f"\n🚀 Available Features:")
        print("   • Manual link input and validation")
        print("   • Batch processing from text files")
        print("   • Link filtering for supported hosts")
        print("   • AllDebrid integration for premium links")
        print("   • Rate limiting and error handling")
        print("   • Results export to JSON")

        print(f"\n📁 Sample Usage:")
        print("   1. Enter links manually one by one")
        print("   2. Process text files containing links")
        print("   3. Get direct download URLs via AllDebrid")


def main():
    """
    Main function with interactive menu
    """
    print("🎬 Streaming Scraper - Manual Processing Mode")
    print("=" * 50)

    # Get AllDebrid API key
    print("\n🔑 AllDebrid Configuration")
    api_key = input("Enter AllDebrid API key (optional, press Enter to skip): ").strip()
    if not api_key:
        api_key = None
        print("⚠️  Continuing without AllDebrid API key")

    scraper = StreamingScraper(alldebrid_api_key=api_key)

    while True:
        print("\n" + "="*40)
        print("📋 MAIN MENU")
        print("="*40)
        print("1. 📊 Show Status")
        print("2. 📝 Manual Link Input")
        print("3. 📁 Process Links from File")
        print("4. 🔧 Test AllDebrid Connection")
        print("5. 🚪 Exit")

        choice = input("\nSelect option (1-5): ").strip()

        if choice == "1":
            scraper.show_status()
        elif choice == "2":
            scraper.manual_link_input_mode()
        elif choice == "3":
            filename = input("Enter filename (e.g., links.txt): ").strip()
            if filename:
                scraper.process_links_from_file(filename)
        elif choice == "4":
            scraper.test_alldebrid_connection()
        elif choice == "5":
            print("\n👋 Goodbye!")
            break
        else:
            print("❌ Invalid option. Please select 1-5.")


if __name__ == "__main__":
    main()